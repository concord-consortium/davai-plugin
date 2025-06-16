import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

// This is used to ensure the CODAP Plugin API documentation Markdown is properly formatted.
export const escapeCurlyBraces = (text: string): string => {
  // Escape curly braces in JSON code blocks
  text = text.replace(/```json\n([\s\S]*?)\n```/g, (match) =>
    match.replace(/{/g, "{{").replace(/}/g, "}}")
  );

  // Escape curly braces in other parts of the text
  text = text.replace(/(?<!\\){/g, "{{").replace(/(?<!\\)}/g, "}}");

  return text;
};

// Split CODAP API documentation into logical chunks by major sections
export const chunkCodapDocumentation = (markdownContent: string): Document[] => {
  const documents: Document[] = [];
  const lines = markdownContent.split("\n");

  // Define the main sections we want to chunk by (H3 headers)
  const sectionStarts: { [key: string]: number } = {};
  const sectionOrder: string[] = [];

  // Find all H3 headers and their line numbers
  lines.forEach((line, index) => {
    const h3Match = line.match(/^\s*### (.+)$/);
    if (h3Match) {
      const sectionName = h3Match[1].trim();
      sectionStarts[sectionName] = index;
      sectionOrder.push(sectionName);
    }
  });

  // Create documents for each major section
  sectionOrder.forEach((sectionName, index) => {
    const startLine = sectionStarts[sectionName];
    const endLine = index < sectionOrder.length - 1
      ? sectionStarts[sectionOrder[index + 1]]
      : lines.length;

    const sectionContent = lines.slice(startLine, endLine).join("\n");

    documents.push(new Document({
      pageContent: escapeCurlyBraces(sectionContent.trim()),
      metadata: {
        section: sectionName,
        type: "codap-api-section",
        startLine: startLine + 1,
        endLine
      }
    }));
  });

  return documents;
};

export const getEmbeddingsModel = (assistantId: string) => {
  if (assistantId === "gemini") {
    return new GoogleGenerativeAIEmbeddings({
      modelName: "embedding-001",
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }
  return new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
  });
};

export const setupVectorStore = async (documents: Document[], assistantId: string, vectorStoreCache: any) => {
  const embeddings = getEmbeddingsModel(assistantId);
  const vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);

  vectorStoreCache[assistantId] = vectorStore;
  return vectorStore;
};
