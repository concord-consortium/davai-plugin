import { TextEncoder } from "util";
import { ReadableStream } from "web-streams-polyfill";
global.TextEncoder = TextEncoder;
global.ReadableStream = ReadableStream as any;
import { escapeCurlyBraces, getEmbeddingsModel, chunkCodapDocumentation, setupVectorStore } from "./rag-utils";

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

  describe("chunkCodapDocumentation", () => {

    it("should split markdown into documents by H3 headers", () => {
      const markdown = `
  # CODAP API

  Some intro text.

  ### Section One
  Content for section one.

  ### Section Two
  Content for section two with {curly} braces.

  ### Section Three
  \`\`\`json
  {
    "key": "value"
  }
  \`\`\`
  End of section three.
      `.trim();

      const docs = chunkCodapDocumentation(markdown);

      expect(docs).toHaveLength(3);

      expect(docs[0].metadata.section).toBe("Section One");
      expect(docs[0].pageContent).toContain("Section One");
      expect(docs[0].metadata.type).toBe("codap-api-section");
      expect(docs[0].metadata.startLine).toBeGreaterThan(0);
      expect(docs[0].metadata.endLine).toBeGreaterThan(docs[0].metadata.startLine);

      expect(docs[1].metadata.section).toBe("Section Two");
      expect(docs[1].pageContent).toContain("Section Two");
      // Should have curly braces escaped
      expect(docs[1].pageContent).toContain("{{curly}}");

      expect(docs[2].metadata.section).toBe("Section Three");
      // Should escape curly braces in JSON code block
      expect(docs[2].pageContent).toContain("{{");
      expect(docs[2].pageContent).toContain("}}");
      expect(docs[2].pageContent).toContain("```json");
    });

    it("should return empty array if no H3 headers", () => {
      const markdown = `
  # No Sections Here

  Just some text.
      `.trim();

      const docs = chunkCodapDocumentation(markdown);
      expect(docs).toHaveLength(0);
    });

    it("should handle markdown with only one section", () => {
      const markdown = `
  ### Only Section
  All the content is here.
      `.trim();

      const docs = chunkCodapDocumentation(markdown);
      expect(docs).toHaveLength(1);
      expect(docs[0].metadata.section).toBe("Only Section");
      expect(docs[0].pageContent).toContain("All the content is here.");
    });
  });
});
