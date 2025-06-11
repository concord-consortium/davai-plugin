import { TextEncoder } from "util";
import { ReadableStream } from "web-streams-polyfill";
global.TextEncoder = TextEncoder;
global.ReadableStream = ReadableStream as any;
import { createModelInstance } from "./index";

jest.mock("./instructions.js", () => ({
  instructions: "Mocked instructions for the CODAP Plugin API.",
}));

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

jest.mock("./utils/rag-utils", () => ({
  ...jest.requireActual("./utils/rag-utils"),
  getEmbeddingsModel: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
  })),
}));

jest.mock("./index", () => ({
  ...jest.requireActual("./index"),
  initializeApp: jest.fn(() => Promise.resolve()),
  processMarkdownDoc: jest.fn(() => Promise.resolve("Mocked processed document")),
}));

jest.mock("langchain/vectorstores/memory", () => ({
  MemoryVectorStore: {
    fromDocuments: jest.fn(() => ({
      addDocuments: jest.fn(),
      similaritySearch: jest.fn(() => [
        { pageContent: "Relevant content 1", metadata: {} },
        { pageContent: "Relevant content 2", metadata: {} },
      ]),
    })),
  },
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
