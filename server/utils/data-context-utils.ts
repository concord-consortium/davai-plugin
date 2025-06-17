import { CHARS_PER_TOKEN, MAX_TOKENS_PER_CHUNK } from "../constants.js";

export interface IDataContextChunk {
  context: string;
  name: string;
}

export interface IProcessedChunk extends Record<string, unknown> {
  content: string;
  role: "user" | "assistant" | "system";
}

/**
 * Splits a large data context into smaller chunks based on token size
 */
export const chunkDataContexts = (contexts: IDataContextChunk[]): IDataContextChunk[][] => {
  const chunks: IDataContextChunk[][] = [];
  let currentChunk: IDataContextChunk[] = [];
  let currentSize = 0;

  for (const context of contexts) {
    const contextStr = JSON.stringify(context);
    const estimatedTokens = contextStr.length / CHARS_PER_TOKEN;

    if (currentSize + estimatedTokens > MAX_TOKENS_PER_CHUNK) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      // If a single context is too large, split it into smaller pieces
      if (estimatedTokens > MAX_TOKENS_PER_CHUNK) {
        const subContexts = splitLargeContext(context);
        chunks.push(...subContexts);
        continue;
      }
    }
    currentChunk.push(context);
    currentSize += estimatedTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * Splits a single large context into smaller chunks based on its attributes
 */
export const splitLargeContext = (context: IDataContextChunk): IDataContextChunk[][] => {
  const chunks: IDataContextChunk[][] = [];
  const contextStr = JSON.stringify(context);
  const estimatedTokens = contextStr.length / CHARS_PER_TOKEN;
  if (estimatedTokens <= MAX_TOKENS_PER_CHUNK) {
    // If the context is small enough, just return it as a single chunk
    return [[context]];
  }
  // console.log(`Context ${context.name} is too large (${estimatedTokens} tokens), splitting...`);

  // split the context into smaller pieces that are under CHUNK_SIZE
  for ( let i = 0; i < contextStr.length; i += MAX_TOKENS_PER_CHUNK * CHARS_PER_TOKEN) {
    const subContextStr = contextStr.slice(i, i + MAX_TOKENS_PER_CHUNK * CHARS_PER_TOKEN);
    const subContext: IDataContextChunk = {
      name: context.name,
      context: subContextStr
    };
    chunks.push([subContext]);
  }

  return chunks;
};

/**
 * Processes data contexts into a series of message chunks
 */
export const processDataContexts = (dataContexts: Record<string, any>): IProcessedChunk[] => {
  const messages: IProcessedChunk[] = [];
  
  const contextsArray = Object.entries(dataContexts).map(([name, context]) => {
    // const contextSize = JSON.stringify(context).length / CHARS_PER_TOKEN;
    // console.log(`Processing context ${name}, size: ${contextSize} tokens`);

    return {
      name,
      context: context ? JSON.stringify(context) : ""
    };
  });
  
  const chunks = chunkDataContexts(contextsArray);
  // console.log(`Created ${chunks.length} chunks`);
  
  // Process chunks and add them as user messages
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkStr = JSON.stringify(chunk);
    // const chunkSize = chunkStr.length / CHARS_PER_TOKEN;
    // console.log(`Processing chunk ${i + 1}/${chunks.length}, size: ${chunkSize} tokens`);

    // Ideally, this would be "system" message, but Gemini doesn't seem to accept more than one system message per session,
    // and these messages get sent separately from the initial system message.
    messages.push({
      content: `CODAP document data contexts chunk ${i + 1}/${chunks.length}: ${chunkStr}`,
      role: "user"
    });
  }

  return messages;
};
