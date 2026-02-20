process.env.POSTGRES_CONNECTION_STRING = "postgres://user:pass@localhost:5432/testdb";
process.env.OPENAI_API_KEY = "dummy-openai-key";
process.env.GOOGLE_API_KEY = "dummy-google-key";
process.env.ANTHROPIC_API_KEY = "dummy-anthropic-key";

import { TextEncoder } from "util";
import { ReadableStream } from "web-streams-polyfill";
global.TextEncoder = TextEncoder as any;
global.ReadableStream = ReadableStream as any;

jest.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: {
    fromConnString: jest.fn(() => ({
      setup: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

jest.mock("pg", () => ({
  Pool: jest.fn(() => ({
    query: jest.fn(),
    end: jest.fn(),
    connect: jest.fn(() => ({
      release: jest.fn(),
      query: jest.fn(),
    })),
  })),
}));

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn(() => ({
    constructor: { name: "ChatOpenAI" },
    invoke: jest.fn(() => ({ response: "Mocked response from OpenAI" })),
    bind: jest.fn(),
  })),
  OpenAIEmbeddings: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
  })),
}));

jest.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: jest.fn(() => ({
    constructor: { name: "ChatGoogleGenerativeAI" },
    invoke: jest.fn(() => ({ response: "Mocked response from Google Generative AI" })),
    bind: jest.fn(),
  })),
}));

jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn(() => ({
    constructor: { name: "ChatAnthropic" },
    invoke: jest.fn(() => ({ response: "Mocked response from Anthropic" })),
    bind: jest.fn(),
  })),
}));

jest.mock("zod", () => ({
  z: {
    object: jest.fn(() => ({
      parse: jest.fn(),
    })),
    string: jest.fn(),
    number: jest.fn(),
  },
}));

import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { createModelInstance, getOrCreateModelInstance } from "./llm-utils";

afterEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe("createModelInstance", () => {
  it("should create an OpenAI model instance", async () => {
    const llmId = JSON.stringify({ id: "gpt-4", provider: "OpenAI" });
    const model = await createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatOpenAI");
  });

  it("should create a Google Generative AI model instance", async () => {
    const llmId = JSON.stringify({ id: "gemini", provider: "Google" });
    const model = await createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatGoogleGenerativeAI");
  });

  it("should create an Anthropic model instance", async () => {
    const llmId = JSON.stringify({ id: "claude-sonnet-4-20250514", provider: "Anthropic" });
    const model = await createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatAnthropic");
  });

  it("should throw an error for unsupported providers", async () => {
    const llmId = JSON.stringify({ id: "unknown", provider: "Unsupported" });

    await expect(() => createModelInstance(llmId)).rejects.toThrow("Unsupported LLM provider: Unsupported");
  });
});

describe("getOrCreateModelInstance", () => {
  it("should bind OpenAI models with parallel_tool_calls disabled", async () => {
    const llmId = JSON.stringify({ id: "gpt-4o", provider: "OpenAI" });
    await getOrCreateModelInstance(llmId);

    const mockInstance = (ChatOpenAI as unknown as jest.Mock).mock.results[0].value;
    expect(mockInstance.bind).toHaveBeenCalledWith(
      expect.objectContaining({ parallel_tool_calls: false })
    );
  });

  it("should bind Google models with parallel_tool_calls disabled", async () => {
    const llmId = JSON.stringify({ id: "gemini-2.0-flash", provider: "Google" });
    await getOrCreateModelInstance(llmId);

    const mockInstance = (ChatGoogleGenerativeAI as unknown as jest.Mock).mock.results[0].value;
    expect(mockInstance.bind).toHaveBeenCalledWith(
      expect.objectContaining({ parallel_tool_calls: false })
    );
  });

  it("should bind Anthropic models with disable_parallel_tool_use in tool_choice", async () => {
    const llmId = JSON.stringify({ id: "claude-sonnet-4-20250514", provider: "Anthropic" });
    await getOrCreateModelInstance(llmId);

    const mockInstance = (ChatAnthropic as unknown as jest.Mock).mock.results[0].value;
    expect(mockInstance.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "auto", disable_parallel_tool_use: true }
      })
    );
    expect(mockInstance.bind).toHaveBeenCalledWith(
      expect.not.objectContaining({ parallel_tool_calls: expect.anything() })
    );
  });
});
