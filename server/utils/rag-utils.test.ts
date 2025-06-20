import { TextEncoder } from "util";
import { ReadableStream } from "web-streams-polyfill";
global.TextEncoder = TextEncoder;
global.ReadableStream = ReadableStream as any;
import { escapeCurlyBraces, getEmbeddingsModel, setupVectorStore } from "./rag-utils";


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

jest.mock("@langchain/openai", () => ({
  OpenAIEmbeddings: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
    modelName: "mock-openai-model",
  })),
}));

jest.mock("@langchain/google-genai", () => ({
  GoogleGenerativeAIEmbeddings: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
    modelName: "mock-google-model",
  })),
}));

afterAll(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe("escapeCurlyBraces", () => {
  it("should escape curly braces in text", () => {
    const input = "This is a test with {curly braces} and {{double braces}}.";
    const expected = "This is a test with {{curly braces}} and {{{{double braces}}}}.";
    expect(escapeCurlyBraces(input)).toBe(expected);
  });
});

describe("getEmbeddingsModel", () => {
  it("should return OpenAI embeddings model", () => {
    const model = getEmbeddingsModel("openai");
    expect(model.modelName).toBe("mock-openai-model");
  });

  it("should return Google Generative AI embeddings model", () => {
    const model = getEmbeddingsModel("gemini");
    expect(model.modelName).toBe("mock-google-model");
  });

  it("should return OpenAI embeddings model for unsupported assistant ID", () => {
    const model = getEmbeddingsModel("unsupported");
    expect(model).toHaveProperty("embedQuery");
    expect(model).toHaveProperty("embedDocuments");
    expect(model.modelName).toBe("mock-openai-model");
  });
});

describe("setupVectorStore", () => {
  it("should setup vector store with documents", async () => {
    const documents = [{ metadata: {}, pageContent: "Test content" }];
    const vectorStore = await setupVectorStore(documents, "openai", {});
    expect(vectorStore).toHaveProperty("addDocuments");
    expect(vectorStore).toHaveProperty("similaritySearch");
  });
});
