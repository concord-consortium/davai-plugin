const CHUNK_SIZE = 4000;
const CHARS_PER_TOKEN = 3; // Conservative token estimate (3 chars ≈ 1 token)

export interface IDataContextChunk {
  context: Record<string, any>;
  name: string;
}

export interface IProcessedChunk {
  content: string;
  role: "user";
}

/**
 * Splits a large data context into smaller chunks based on token size
 */
const chunkDataContexts = (contexts: IDataContextChunk[]): IDataContextChunk[][] => {
  const chunks: IDataContextChunk[][] = [];
  let currentChunk: IDataContextChunk[] = [];
  let currentSize = 0;

  for (const context of contexts) {
    const contextStr = JSON.stringify(context);
    const estimatedTokens = contextStr.length / CHARS_PER_TOKEN;

    if (currentSize + estimatedTokens > CHUNK_SIZE) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }

      // If a single context is too large, split it into smaller pieces
      if (estimatedTokens > CHUNK_SIZE) {
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
const splitLargeContext = (context: IDataContextChunk): IDataContextChunk[][] => {
  const chunks: IDataContextChunk[][] = [];
  
  // Get the collections array from the context
  const collections = context.context?.collections;
  if (!collections || !Array.isArray(collections) || collections.length === 0) {
    // console.log("No collections found, sending whole context");
    chunks.push([context]);
    return chunks;
  }

  // Get the first collection
  const firstCollection = collections[0];
  
  // Get the attributes from the collection
  const attributes = firstCollection.attrs;
  if (!attributes || !Array.isArray(attributes)) {
    // console.log("No attributes found in collection, sending whole context");
    chunks.push([context]);
    return chunks;
  }

  // Calculate how many attributes we can fit in each chunk
  // We'll aim for 3500 tokens per chunk to leave room for metadata
  const attrsPerChunk = Math.floor(3500 / (JSON.stringify(attributes[0]).length / CHARS_PER_TOKEN));
  // console.log(`Splitting ${attributes.length} attributes into chunks of ${attrsPerChunk} attributes each`);

  // Split the attributes into chunks
  for (let i = 0; i < attributes.length; i += attrsPerChunk) {
    const chunkAttrs = attributes.slice(i, i + attrsPerChunk);
    const chunk = [{
      name: context.name,
      context: {
        ...context.context,
        collections: [{
          ...firstCollection,
          attrs: chunkAttrs
        }]
      }
    }];

    // Log the size of each chunk
    // const chunkSize = JSON.stringify(chunk).length / CHARS_PER_TOKEN;
    // console.log(`Chunk ${i / attrsPerChunk + 1} size: ${chunkSize} tokens`);
    
    chunks.push(chunk);
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
      context: context as Record<string, any>
    };
  });
  
  const chunks = chunkDataContexts(contextsArray);
  // console.log(`Created ${chunks.length} chunks`);
  
  // Process chunks and add them as user messages
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkStr = JSON.stringify(chunk);
    const chunkSize = chunkStr.length / CHARS_PER_TOKEN;
    // console.log(`Processing chunk ${i + 1}/${chunks.length}, size: ${chunkSize} tokens`);
    
    // For chunks that are still too large, split them further
    if (chunkSize > 7000) {
      // console.log(`Chunk ${i + 1} too large (${chunkSize} tokens), splitting further...`);
      const subChunks = splitLargeContext(chunk[0]);
      for (const subChunk of subChunks) {
        const subChunkStr = JSON.stringify(subChunk);
        // const subChunkSize = subChunkStr.length / CHARS_PER_TOKEN;
        // console.log(`Sub-chunk size: ${subChunkSize} tokens`);
        messages.push({ 
          role: "user", 
          content: `Data context sub-chunk: ${subChunkStr}` 
        });
      }
    } else {
      messages.push({ 
        role: "user", 
        content: `Data contexts chunk ${i + 1}/${chunks.length}: ${chunkStr}` 
      });
    }
  }

  return messages;
};
