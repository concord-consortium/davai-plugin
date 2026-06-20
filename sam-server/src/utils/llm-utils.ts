import * as dotenv from "dotenv";
dotenv.config();

import { ChatOpenAI } from "@langchain/openai";
import { START, END, StateGraph, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseMessage, trimMessages } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { instructions } from "../text/instructions.js";
import { codapApiDoc } from "../text/codap-api-documentation.js";
import { extractToolCalls, toolCallResponse, tools } from "./tool-utils.js";
import { tokenCounter, escapeCurlyBraces } from "./utils.js";
import { MAX_TOKENS } from "../constants.js";
import { getAnthropicKey, getGoogleKey, getOpenAIKey } from "./env-utils.js";

if (!process.env.POSTGRES_CONNECTION_STRING) {
  throw new Error("POSTGRES_CONNECTION_STRING environment variable is not set.");
}

const checkpointer = PostgresSaver.fromConnString(process.env.POSTGRES_CONNECTION_STRING);

// Initialize checkpointer when module loads
const checkpointPromise = checkpointer.setup();

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

// OpenAI reasoning models (the gpt-5 family and the o-series) reject any
// non-default temperature, returning a 400. They must be created with the only
// supported value (1) rather than the 0 we use for standard chat models.
const isOpenAIReasoningModel = (id: string) => /^(gpt-5|o\d)/i.test(id);

// Opus 4.7+ removed the sampling parameters entirely — sending temperature, top_p, or
// top_k returns a 400. (Opus 4.6 and earlier still accept temperature.) The 0.3.x library
// always sends all three, so for these models we override them to undefined to omit them.
const isAnthropicNoSamplingModel = (id: string) => /^claude-opus-4-(?:[7-9]|\d\d)/.test(id);

export const createModelInstance = async (llm: string) => {
  const llmObj = JSON.parse(llm);
  const { id, provider } = llmObj;

  if (provider === "OpenAI") {
    const apiKey = await getOpenAIKey();
    return new ChatOpenAI({
      model: id,
      temperature: isOpenAIReasoningModel(id) ? 1 : 0,
      apiKey,
    });
  }

  if (provider === "Google") {
    const apiKey = await getGoogleKey();
    return new ChatGoogleGenerativeAI({
      model: id,
      temperature: 0,
      apiKey,
    });
  }

  if (provider === "Anthropic") {
    const apiKey = await getAnthropicKey();
    if (isAnthropicNoSamplingModel(id)) {
      // Opus 4.7+ reject temperature/top_p/top_k entirely; omit all sampling params.
      return new ChatAnthropic({
        model: id,
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
        apiKey,
      });
    }
    return new ChatAnthropic({
      model: id,
      temperature: 0,
      // @langchain/anthropic 0.3.x always sends top_p (default sentinel -1). Newer Claude
      // models reject `top_p: -1` AND reject temperature+top_p together, so we override
      // top_p to undefined via invocationKwargs (spread last into messages.create()) to
      // omit it and send only temperature.
      invocationKwargs: { top_p: undefined },
      apiKey,
    });
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
};

export const getOrCreateModelInstance = async (llmId: string): Promise<any> => {
  if (!llmInstances[llmId]) {
    const model = await createModelInstance(llmId);
    const { provider } = JSON.parse(llmId);
    const callOptions: Record<string, any> =
      provider === "Anthropic"
        // Anthropic uses disable_parallel_tool_use in tool_choice instead of parallel_tool_calls
        ? { tool_choice: { type: "auto", disable_parallel_tool_use: true } }
        : { parallel_tool_calls: false };
    llmInstances[llmId] = (model as any).bindTools(tools, callOptions);
  }

  return llmInstances[llmId];
};

const callModel = async (state: any, modelConfig: any) => {
  const { llmId } = modelConfig.configurable;
  const llm = await getOrCreateModelInstance(llmId);

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
  try {
    await checkpointPromise;
  } catch (error) {
    console.error("Checkpointer setup failed: ", error);
  }

  return workflow.compile({ checkpointer });
};
