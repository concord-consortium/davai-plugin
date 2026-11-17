import * as dotenv from "dotenv";
dotenv.config();

import { ChatOpenAI } from "@langchain/openai";
import { START, END, StateGraph, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage, trimMessages } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { MemorySaver } from "@langchain/langgraph";
import { instructions } from "../text/instructions.js";
import { codapApiDoc } from "../text/codap-api-documentation.js";
import { extractToolCalls, toolCallResponse, tools } from "./tool-utils.js";
import { tokenCounter, escapeCurlyBraces } from "./utils.js";
import { MAX_TOKENS } from "../constants.js";
import { getAnthropicKey, getGoogleKey, getOpenAIKey } from "./env-utils.js";

// In-VM checkpointer: conversation state lives in this microVM's memory for the
// session's life. AgentCore pins every request carrying the same runtimeSessionId
// (== thread_id) to this same VM, so no shared/serialized store is needed. This is
// the change that removes the RDS Postgres + SQS round-trip (was PostgresSaver).
const checkpointer = new MemorySaver();

let llmInstances: Record<string, any> = {};

const promptTemplate = ChatPromptTemplate.fromMessages([
    [ "system",
      `${instructions}

      ### CODAP API documentation:
      ${escapeCurlyBraces(codapApiDoc)}

      ### Current CODAP Data Contexts:
      {dataContexts}

      ### Current CODAP Graphs:
      {graphs}`
    ],
    ["placeholder", "{messages}"],
]);

// OpenAI reasoning models (the gpt-5 family and the o-series). These are routed through
// the Responses API and built without a temperature — they only accept the default, and
// Responses can reject the parameter outright (see createModelInstance). Standard chat
// models stay on Chat Completions with temperature 0.
const isOpenAIReasoningModel = (id: string) => /^(gpt-5|o\d)/i.test(id);

// Adaptive-thinking-only Anthropic models removed the sampling parameters entirely —
// sending temperature, top_p, or top_k returns a 400. This is the Opus 4.7+ line and the
// "5"-generation Sonnet (Sonnet 5); models that still support extended thinking (Opus 4.6,
// Sonnet 4.6, Haiku 4.5) still accept temperature. The library always sends all three, so
// for these models we omit them.
const isAnthropicNoSamplingModel = (id: string) =>
  /^claude-opus-4-(?:[7-9]|\d\d)/.test(id) || /^claude-sonnet-5/.test(id);

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

  const prompt = await promptTemplate.invoke({
    messages: trimmedMessages,
    dataContexts: JSON.stringify(state.dataContexts || {}, null, 2),
    graphs: JSON.stringify(state.graphs || [], null, 2),
  });

  const response = await llm.invoke(prompt);
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
  // MemorySaver needs no async setup (unlike PostgresSaver.setup()).
  return workflow.compile({ checkpointer });
};
