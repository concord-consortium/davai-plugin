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

import { createModelInstance } from "./llm-utils";

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

  it("should throw an error for unsupported providers", async () => {
    const llmId = JSON.stringify({ id: "unknown", provider: "Unsupported" });

    await expect(() => createModelInstance(llmId)).rejects.toThrow("Unsupported LLM provider: Unsupported");
  });
});
