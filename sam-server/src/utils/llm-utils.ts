import * as dotenv from "dotenv";
dotenv.config();

import { ChatOpenAI } from "@langchain/openai";
import { START, END, StateGraph, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage, SystemMessage, trimMessages } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { instructions } from "../text/instructions.js";
import { codapApiDoc } from "../text/codap-api-documentation.js";
import { extractToolCalls, toolCallResponse, tools } from "./tool-utils.js";
import { tokenCounter } from "./utils.js";
import { MAX_TOKENS } from "../constants.js";
import { getAnthropicKey, getGoogleKey, getOpenAIKey } from "./env-utils.js";

if (!process.env.POSTGRES_CONNECTION_STRING) {
  throw new Error("POSTGRES_CONNECTION_STRING environment variable is not set.");
}

const checkpointer = PostgresSaver.fromConnString(process.env.POSTGRES_CONNECTION_STRING);

// Initialize checkpointer when module loads
const checkpointPromise = checkpointer.setup();

let llmInstances: Record<string, any> = {};

// The system prompt is split at a cache boundary: the stable prefix (instructions +
// API doc — identical for every request) versus the per-request CODAP state. Built as
// plain strings, not a ChatPromptTemplate, so the API doc's braces need no escaping
// and Anthropic's cache_control content blocks can be attached directly.
const STABLE_SYSTEM_PREFIX = `${instructions}

      ### CODAP API documentation:
      ${codapApiDoc}`;

const volatileSystemSuffix = (dataContexts: any, graphs: any) => `

      ### Current CODAP Data Contexts:
      ${JSON.stringify(dataContexts || {}, null, 2)}

      ### Current CODAP Graphs:
      ${JSON.stringify(graphs || [], null, 2)}`;

// Anthropic prompt caching is opt-in per request: the cache_control breakpoint on the
// stable block caches everything before it (the static tool definitions render ahead of
// the system prompt, so they are covered too). Reads bill at ~0.1x input, and the
// prefix is identical across users and turns, so every turn after the first within the
// cache TTL hits it. Other providers cache automatically on their side and get the
// same text as a single plain string — the split must not change prompt bytes.
export const buildSystemMessage = (provider: string, dataContexts: any, graphs: any) => {
  const volatile = volatileSystemSuffix(dataContexts, graphs);
  if (provider === "Anthropic") {
    return new SystemMessage({
      content: [
        { type: "text", text: STABLE_SYSTEM_PREFIX, cache_control: { type: "ephemeral" } },
        { type: "text", text: volatile },
      ] as any,
    });
  }
  return new SystemMessage({ content: STABLE_SYSTEM_PREFIX + volatile });
};

// OpenAI reasoning models (the gpt-5 family and the o-series). These are routed through
// the Responses API and built without a temperature — they only accept the default, and
// Responses can reject the parameter outright (see createModelInstance). Standard chat
// models stay on Chat Completions with temperature 0.
const isOpenAIReasoningModel = (id: string) => /^(gpt-5|o\d)/i.test(id);

// Adaptive-thinking-only Anthropic models removed the sampling parameters entirely —
// sending temperature, top_p, or top_k returns a 400. That is the Opus 4.7+ line plus
// every family at generation 5 or later (Opus 5, Sonnet 5, Fable 5, Mythos 5, ...);
// models that still support extended thinking (Opus 4.6, Sonnet 4.6, Haiku 4.5) still
// accept temperature, so we set it to 0 only for those. The generation test matches ANY
// family name (lowercase segments, hyphenated allowed) and multi-digit generations,
// deliberately broad: omitting temperature from a model that would accept it merely loses
// determinism, while sending it to one that doesn't fails the whole turn. Digit-led legacy
// ids (claude-3-5-sonnet-*) can't match the family segment and keep temperature 0.
const isAnthropicNoSamplingModel = (id: string) =>
  /^claude-opus-4-(?:[7-9]|\d\d)/.test(id) || /^claude-[a-z]+(?:-[a-z]+)*-(?:[5-9]|\d{2,})/.test(id);

// Anthropic models that accept output_config.effort (Opus 4.5+, Sonnet 4.6+, Sonnet 5;
// NOT Haiku 4.5, which has no effort parameter).
const isAnthropicEffortModel = (id: string) => !/^claude-haiku/.test(id);

export const createModelInstance = async (llm: string, effort?: string) => {
  const llmObj = JSON.parse(llm);
  const { id, provider } = llmObj;

  if (provider === "OpenAI") {
    const apiKey = await getOpenAIKey();
    if (isOpenAIReasoningModel(id)) {
      // Reasoning models (gpt-5 family, o-series) go through the Responses API
      // (/v1/responses): Chat Completions rejects reasoning_effort when function tools are
      // bound (400), while Responses supports it and preserves the model's reasoning across
      // tool-call round trips. Temperature is omitted entirely — these models only accept
      // the default, and Responses can reject the parameter outright.
      return new ChatOpenAI({
        model: id,
        apiKey,
        useResponsesApi: true,
        ...(effort ? { reasoning: { effort: effort as any } } : {}),
      });
    }
    return new ChatOpenAI({
      model: id,
      temperature: 0,
      apiKey,
    });
  }

  if (provider === "Google") {
    const apiKey = await getGoogleKey();
    // No effort/thinking-level here: the installed @langchain/google-genai 2.2.0 only
    // supports LOW/MEDIUM/HIGH (no "minimal") for thinkingLevel, so forwarding the config's
    // Gemini levels would send invalid requests. Gemini effort is disabled for now (its
    // llmList entries carry no effortLevels); leave these models exactly as they were.
    return new ChatGoogleGenerativeAI({
      model: id,
      temperature: 0,
      apiKey,
    });
  }

  if (provider === "Anthropic") {
    const apiKey = await getAnthropicKey();
    // @langchain/anthropic 1.x omits top_p/top_k unless explicitly set, and auto-omits all
    // sampling params for adaptive-only models (Opus 4.7+) — throwing if any are passed. So
    // set temperature: 0 only for models that accept it; leave it unset for Opus 4.7+.
    return new ChatAnthropic({
      model: id,
      ...(isAnthropicNoSamplingModel(id) ? {} : { temperature: 0 }),
      apiKey,
      ...(effort && isAnthropicEffortModel(id) ? { outputConfig: { effort: effort as any } } : {}),
    });
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
};

export const getOrCreateModelInstance = async (llmId: string, effort?: string): Promise<any> => {
  const cacheKey = `${llmId}::${effort ?? ""}`;
  if (!llmInstances[cacheKey]) {
    const model = await createModelInstance(llmId, effort);
    const { provider } = JSON.parse(llmId);
    const callOptions: Record<string, any> =
      provider === "Anthropic"
        // Anthropic uses disable_parallel_tool_use in tool_choice instead of parallel_tool_calls
        ? { tool_choice: { type: "auto", disable_parallel_tool_use: true } }
        : { parallel_tool_calls: false };
    llmInstances[cacheKey] = (model as any).bindTools(tools, callOptions);
  }

  return llmInstances[cacheKey];
};

const callModel = async (state: any, modelConfig: any) => {
  const { llmId, effort } = modelConfig.configurable;
  const llm = await getOrCreateModelInstance(llmId, effort);

  // Use the trimmer to ensure we don't send too much to the model
  // The trimmer is used to limit the number of tokens in the conversation history.
  const trimmer = trimMessages({
    maxTokens: MAX_TOKENS,
    strategy: "last",
    tokenCounter,
    includeSystem: true,
    allowPartial: true,
  });
  const trimmedMessages = await trimmer.invoke(state.messages);

  const { provider } = JSON.parse(llmId);
  const systemMessage = buildSystemMessage(provider, state.dataContexts, state.graphs);

  const response = await llm.invoke([systemMessage, ...trimmedMessages]);
  return { messages: response };
};

export const buildResponse = async (message: BaseMessage) => {
  const toolCalls = extractToolCalls(message);

  // If there are tool calls, we need to handle them first.
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls[0]);
  } else {
    return { response: message.content };
  }
};

// define custom state annotation that includes CODAP data
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  dataContexts: Annotation<Record<string, any>>({
    reducer: (x, y) => y || x || {},
  }),
  graphs: Annotation<any[]>({
    reducer: (x, y) => y || x || [],
  }),
});

const workflow = new StateGraph(StateAnnotation)
  .addNode("model", callModel)
  .addEdge(START, "model")
  .addEdge("model", END);

const devMode = process.env.DEV_MODE === "true";
if (devMode) {
  console.log("DEV_MODE: langApp instances will be cached per sessionId");
}

export const getLangApp = async () => {
  try {
    await checkpointPromise;
  } catch (error) {
    console.error("Checkpointer setup failed: ", error);
  }

  return workflow.compile({ checkpointer });
};
