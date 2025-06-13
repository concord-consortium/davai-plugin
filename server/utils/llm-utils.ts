import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createRequestTool } from "../tools.js";

export const createModelInstance = (llm: string) => {
  const llmObj = JSON.parse(llm);
  const { id, provider } = llmObj;
  const tools = [createRequestTool];

  if (provider === "OpenAI") {
    return new ChatOpenAI({
      model: id,
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    }).bindTools(tools);
  }

  if (provider === "Google") {
    return new ChatGoogleGenerativeAI({
      model: id,
      temperature: 0,
      apiKey: process.env.GOOGLE_API_KEY,
    }).bindTools(tools);
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
};
