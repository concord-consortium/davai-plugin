import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

// This is used to ensure the CODAP Plugin API documentation Markdown is properly formatted.
export const escapeCurlyBraces = (text: string): string => {
  // First, handle JSON code blocks by replacing their braces with a temporary marker
  text = text.replace(/```json\n([\s\S]*?)\n```/g, (match) => {
    return match
      .replace(/{/g, "[[OPEN_BRACE]]")
      .replace(/}/g, "[[CLOSE_BRACE]]");
  });

  // Handle any existing escaped braces
  text = text.replace(/\\{/g, "{{").replace(/\\}/g, "}}");
  
  // Handle comments with braces
  text = text.replace(/\/\*.*?\*\//g, (match) => {
    return match.replace(/{/g, "{{").replace(/}/g, "}}");
  });
  
  // Handle inline code blocks with braces
  text = text.replace(/`.*?`/g, (match) => {
    return match.replace(/{/g, "{{").replace(/}/g, "}}");
  });
  
  // Handle JSON-like objects that aren't part of template variables
  text = text.replace(/(?<!\\){([^{}]*?)(?<!\\)}/g, "{{$1}}");
  
  // Handle any remaining single braces
  text = text.replace(/(?<!\\){/g, "{{");
  text = text.replace(/(?<!\\)}/g, "}}");

  // Restore the JSON code blocks
  text = text
    .replace(/\[\[OPEN_BRACE\]\]/g, "{")
    .replace(/\[\[CLOSE_BRACE\]\]/g, "}");
  
  return text;
};

// Splits by markdown headers
const markdownSplitter = new MarkdownTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// For any chunks that are too large, use recursive character splitter
const recursiveSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
  separators: ["\n\n", "\n", ".", "!", "?", ",", " ", ""],
});

export const processMarkdownDoc = async (markdownContent: string) => {
  const escapedInstructions = escapeCurlyBraces(markdownContent);
  const markdownChunks = await markdownSplitter.createDocuments([escapedInstructions]);

  const processedChunks = await Promise.all(
    markdownChunks.map(async (chunk) => {
      // If chunk is too large, split it further
      if (chunk.pageContent.length > 1000) {
        const subChunks = await recursiveSplitter.createDocuments([chunk.pageContent]);
        return subChunks;
      }
      return [chunk];
    })
  );

  return processedChunks.flat();
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
