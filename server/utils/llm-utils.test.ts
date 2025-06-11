import { TextEncoder } from "util";
import { ReadableStream } from "web-streams-polyfill";
global.TextEncoder = TextEncoder;
global.ReadableStream = ReadableStream as any;
import { createModelInstance } from "./llm-utils";

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn(() => ({
    constructor: {
      name: "ChatOpenAI",
    },
    invoke: jest.fn(() => ({
      response: "Mocked response from OpenAI",
    })),
  })),
  OpenAIEmbeddings: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
  })),
}));

jest.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: jest.fn(() => ({
    constructor: {
      name: "ChatGoogleGenerativeAI",
    },
    invoke: jest.fn(() => ({
      response: "Mocked response from Google Generative AI",
    })),
  })),
}));

jest.mock("./rag-utils", () => ({
  ...jest.requireActual("./rag-utils"),
  getEmbeddingsModel: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
  })),
}));

afterAll(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe("createModelInstance", () => {
  it("should create an OpenAI model instance", () => {
    const llmId = JSON.stringify({ id: "gpt-4", provider: "OpenAI" });
    const model = createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatOpenAI");
  });

  it("should create a Google Generative AI model instance", () => {
    const llmId = JSON.stringify({ id: "gemini", provider: "Google" });
    const model = createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatGoogleGenerativeAI");
  });

  it("should throw an error for unsupported providers", () => {
    const llmId = JSON.stringify({ id: "unknown", provider: "Unsupported" });

    expect(() => createModelInstance(llmId)).toThrow("Unsupported LLM provider: Unsupported");
  });
});
