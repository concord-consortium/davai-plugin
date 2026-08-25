process.env.POSTGRES_CONNECTION_STRING = "postgres://user:pass@localhost:5432/testdb";
process.env.OPENAI_API_KEY = "dummy-openai-key";
process.env.GOOGLE_API_KEY = "dummy-google-key";
process.env.ANTHROPIC_API_KEY = "dummy-anthropic-key";

import { TextEncoder } from "util";
import { ReadableStream } from "node:stream/web";
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
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn(),
    connect: jest.fn(() =>
      Promise.resolve({
        release: jest.fn(),
        query: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      })
    ),
  })),
}));

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn(() => ({
    invoke: jest.fn(),
    bind: jest.fn(),
    bindTools: jest.fn(),
  })),
  OpenAIEmbeddings: jest.fn(() => ({
    embedQuery: jest.fn(),
    embedDocuments: jest.fn(),
  })),
}));

jest.mock("@langchain/google-genai", () => ({
  ChatGoogleGenerativeAI: jest.fn(() => ({
    invoke: jest.fn(),
    bind: jest.fn(),
    bindTools: jest.fn(),
  })),
}));

jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn(() => ({
    invoke: jest.fn(),
    bind: jest.fn(),
    bindTools: jest.fn(),
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

jest.mock("../utils/env-utils", () => ({
  getLangSmithKey: jest.fn().mockResolvedValue(""),
}));

import { buildResponse } from "./job-processor";

// Covers the LIVE SAM poll path: job-processor.ts keeps its own buildResponse
// (the copy in ../utils/llm-utils.ts has no production caller), so usage
// attachment must be verified here too.
describe("job-processor buildResponse usage passthrough", () => {
  it("attaches usage_metadata to plain responses", async () => {
    const message: any = {
      content: "hi",
      usage_metadata: {
        input_tokens: 100,
        output_tokens: 5,
        input_token_details: { cache_read: 80, cache_creation: 0 },
      },
    };
    const out: any = await buildResponse(message);
    expect(out.response).toBe("hi");
    expect(out.usage).toEqual(message.usage_metadata);
  });

  it("omits usage when the message has none", async () => {
    const out: any = await buildResponse({ content: "hi" } as any);
    expect(out.usage).toBeUndefined();
  });

  it("still coerces Anthropic content-block arrays to a string", async () => {
    const message: any = {
      content: [{ type: "text", text: "hello" }, { type: "text", text: " world" }],
      usage_metadata: { input_tokens: 10, output_tokens: 2 },
    };
    const out: any = await buildResponse(message);
    expect(out.response).toBe("hello world");
    expect(out.usage).toEqual(message.usage_metadata);
  });
});
