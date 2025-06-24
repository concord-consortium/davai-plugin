import { CHARS_PER_TOKEN, MAX_TOKENS_PER_CHUNK } from "../constants.js";

export interface ICodapDataChunk {
  data: string;
  name: string;
}

export interface IProcessedChunk extends Record<string, unknown> {
  content: string;
  role: "user" | "assistant" | "system";
}

/**
 * Splits a large data object into smaller chunks based on token size
 */
export const chunkData = (data: ICodapDataChunk[]): ICodapDataChunk[][] => {
  const chunks: ICodapDataChunk[][] = [];
  let currentChunk: ICodapDataChunk[] = [];
  let currentSize = 0;

  for (const dataObject of data) {
    const dataStr = JSON.stringify(dataObject);
    const estimatedTokens = dataStr.length / CHARS_PER_TOKEN;

    if (currentSize + estimatedTokens > MAX_TOKENS_PER_CHUNK) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      // If a single data chunk is too large, split it into smaller pieces
      if (estimatedTokens > MAX_TOKENS_PER_CHUNK) {
        const subChunks = splitLargeChunk(dataObject);
        chunks.push(...subChunks);
        continue;
      }
    }
    currentChunk.push(dataObject);
    currentSize += estimatedTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * Splits a single large data chunk into smaller chunks based on its attributes
 */
export const splitLargeChunk = (dataChunk: ICodapDataChunk): ICodapDataChunk[][] => {
  const chunks: ICodapDataChunk[][] = [];
  const dataChunkStr = JSON.stringify(dataChunk);
  const estimatedTokens = dataChunkStr.length / CHARS_PER_TOKEN;
  if (estimatedTokens <= MAX_TOKENS_PER_CHUNK) {
    // If the chunk is small enough, just return it as a single chunk
    return [[dataChunk]];
  }

  // split the chunk into smaller pieces that are under CHUNK_SIZE
  for ( let i = 0; i < dataChunkStr.length; i += MAX_TOKENS_PER_CHUNK * CHARS_PER_TOKEN) {
    const subChunkStr = dataChunkStr.slice(i, i + MAX_TOKENS_PER_CHUNK * CHARS_PER_TOKEN);
    const subChunk: ICodapDataChunk = {
      name: dataChunk.name,
      data: subChunkStr
    };
    chunks.push([subChunk]);
  }

  return chunks;
};

/**
 * Processes data into a series of message chunks
 */
export const processCodapData = (data: Record<string, any>): IProcessedChunk[] => {
  const messages: IProcessedChunk[] = [];

  const dataArray = Object.entries(data).map(([name, dataObject]) => {
    return {
      name,
      data: dataObject ? JSON.stringify(dataObject) : ""
    };
  });

  const chunks = chunkData(dataArray);
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
      content: `CODAP document data chunk ${i + 1}/${chunks.length}: ${chunkStr}`,
      role: "user"
    });
  }

  return messages;
};
