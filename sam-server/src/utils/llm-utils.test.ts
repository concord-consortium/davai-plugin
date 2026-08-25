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
    query: jest.fn(),
    end: jest.fn(),
    connect: jest.fn(() => ({
      release: jest.fn(),
      query: jest.fn(),
    })),
  })),
}));

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn(() => ({
    constructor: { name: "ChatOpenAI" },
    invoke: jest.fn(() => ({ response: "Mocked response from OpenAI" })),
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
    constructor: { name: "ChatGoogleGenerativeAI" },
    invoke: jest.fn(() => ({ response: "Mocked response from Google Generative AI" })),
    bind: jest.fn(),
    bindTools: jest.fn(),
  })),
}));

jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn(() => ({
    constructor: { name: "ChatAnthropic" },
    invoke: jest.fn(() => ({ response: "Mocked response from Anthropic" })),
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

import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { buildResponse, buildSystemMessage, createModelInstance, getOrCreateModelInstance } from "./llm-utils";

afterEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

describe("buildSystemMessage (Anthropic prompt caching)", () => {
  const dataContexts = { Mammals: { type: "dataContext" } };
  const graphs = [{ id: 42, plotType: "scatterPlot" }];

  it("splits the Anthropic system prompt into a cached stable block and an uncached volatile block", () => {
    const msg = buildSystemMessage("Anthropic", dataContexts, graphs);
    const blocks = msg.content as any[];

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(2);
    // Block 1: instructions + API doc, marked cacheable — identical for every request.
    expect(blocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[0].text).toContain("### CODAP API documentation:");
    // Block 2: per-request data, NOT cacheable (any breakpoint here would thrash).
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[1].text).toContain("### Current CODAP Data Contexts:");
    expect(blocks[1].text).toContain("Mammals");
    expect(blocks[1].text).toContain("### Current CODAP Graphs:");
    // The volatile data must not leak into the cached block.
    expect(blocks[0].text).not.toContain("Mammals");
  });

  it("gives other providers a single plain-string system message", () => {
    for (const provider of ["OpenAI", "Google"]) {
      const msg = buildSystemMessage(provider, dataContexts, graphs);
      expect(typeof msg.content).toBe("string");
      expect(msg.content).toContain("### CODAP API documentation:");
      expect(msg.content).toContain("Mammals");
    }
  });

  it("produces byte-identical prompt text for Anthropic and other providers", () => {
    // The split must not change what any model actually reads.
    const anthropic = buildSystemMessage("Anthropic", dataContexts, graphs);
    const openai = buildSystemMessage("OpenAI", dataContexts, graphs);
    const joined = (anthropic.content as any[]).map((b) => b.text).join("");
    expect(joined).toBe(openai.content);
  });
});

describe("createModelInstance", () => {
  it("should create an OpenAI model instance", async () => {
    const llmId = JSON.stringify({ id: "gpt-4", provider: "OpenAI" });
    const model = await createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatOpenAI");
  });

  it("should create a Google Generative AI model instance", async () => {
    const llmId = JSON.stringify({ id: "gemini", provider: "Google" });
    const model = await createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatGoogleGenerativeAI");
  });

  it("should create an Anthropic model instance", async () => {
    const llmId = JSON.stringify({ id: "claude-sonnet-4-6", provider: "Anthropic" });
    const model = await createModelInstance(llmId);

    expect(model).toBeDefined();
    expect(model.constructor.name).toBe("ChatAnthropic");
  });

  it("should set temperature 0 for Anthropic models that accept sampling params (e.g. Sonnet 4.6)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-sonnet-4-6", provider: "Anthropic" }));

    const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
    // No top_p / invocationKwargs: @langchain/anthropic 1.x omits top_p unless explicitly set.
    expect(callArgs.topP).toBeUndefined();
    expect(callArgs.invocationKwargs).toBeUndefined();
  });

  it("should set temperature 0 for Opus 4.6 (not adaptive-only)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-opus-4-6", provider: "Anthropic" }));

    const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.invocationKwargs).toBeUndefined();
  });

  it("should not set sampling params for Opus 4.7+ (adaptive-only; 1.x omits/rejects them)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-opus-4-8", provider: "Anthropic" }));

    const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    // Leave all sampling params unset; 1.x auto-omits them for adaptive-only models.
    expect(callArgs.temperature).toBeUndefined();
    expect(callArgs.topP).toBeUndefined();
    expect(callArgs.invocationKwargs).toBeUndefined();
  });

  it("should not set sampling params for Sonnet 5 (adaptive-only, like Opus 4.7+)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-sonnet-5", provider: "Anthropic" }));

    const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBeUndefined();
    expect(callArgs.topP).toBeUndefined();
    expect(callArgs.invocationKwargs).toBeUndefined();
  });

  it("should not set sampling params for Opus 5 (whole 5 generation is adaptive-only)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-opus-5", provider: "Anthropic" }));

    const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBeUndefined();
    expect(callArgs.topP).toBeUndefined();
    expect(callArgs.invocationKwargs).toBeUndefined();
  });

  it("treats every family at generation 5+ as adaptive-only (any family name, multi-digit gens)", async () => {
    // The gate is intentionally family-agnostic and open-ended: Mythos/Fable exist today,
    // and future names or generations >= 10 must not silently regress to sampling params.
    for (const id of ["claude-mythos-5", "claude-fable-5", "claude-haiku-5", "claude-opus-10", "claude-new-thing-5"]) {
      (ChatAnthropic as unknown as jest.Mock).mockClear();
      await createModelInstance(JSON.stringify({ id, provider: "Anthropic" }));
      const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
      expect({ id, temperature: callArgs.temperature }).toEqual({ id, temperature: undefined });
    }
  });

  it("still sets temperature 0 for legacy dashed-generation ids (claude-3-5-sonnet-*)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-3-5-sonnet-20241022", provider: "Anthropic" }));

    const callArgs = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
  });

  it("keeps the Anthropic sampling gate identical to the AgentCore backend copy", () => {
    // The two implementations are duplicated by design (client/server package boundary).
    // This guard fails when one copy's gate changes without the other.
    const fs = require("fs");
    const path = require("path");
    const extract = (file: string) => {
      const src = fs.readFileSync(file, "utf8");
      const match = src.match(/const isAnthropicNoSamplingModel = [^;]+;/);
      if (!match) throw new Error(`isAnthropicNoSamplingModel not found in ${file}`);
      return match[0];
    };
    const samCopy = extract(path.join(__dirname, "llm-utils.ts"));
    const backendCopy = extract(path.join(__dirname, "../../../backend/src/agent/utils/llm-utils.ts"));
    expect(backendCopy).toBe(samCopy);
  });

  it("routes the gpt-5.6 family through the Responses API", async () => {
    await createModelInstance(JSON.stringify({ id: "gpt-5.6-sol", provider: "OpenAI" }), "max");

    const args = (ChatOpenAI as unknown as jest.Mock).mock.calls[0][0];
    expect(args.useResponsesApi).toBe(true);
    expect(args.temperature).toBeUndefined();
    expect(args.reasoning).toEqual({ effort: "max" });
  });

  it("builds gemini-3.7-flash on the standard Google branch with temperature 0", async () => {
    await createModelInstance(JSON.stringify({ id: "gemini-3.7-flash", provider: "Google" }));

    const args = (ChatGoogleGenerativeAI as unknown as jest.Mock).mock.calls[0][0];
    expect(args.model).toBe("gemini-3.7-flash");
    expect(args.temperature).toBe(0);
  });

  it("applies Anthropic effort via outputConfig", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-sonnet-5", provider: "Anthropic" }), "low");
    const args = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(args.outputConfig).toEqual({ effort: "low" });
  });

  it("does not set Anthropic effort for haiku (no support)", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }), "low");
    const args = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(args.outputConfig).toBeUndefined();
  });

  it("applies OpenAI effort via reasoning on the Responses API", async () => {
    // OpenAI rejects reasoning_effort + function tools on Chat Completions, so reasoning
    // models use the Responses API (useResponsesApi), where the constructor `reasoning`
    // field carries the effort.
    await createModelInstance(JSON.stringify({ id: "gpt-5.5", provider: "OpenAI" }), "high");
    const args = (ChatOpenAI as unknown as jest.Mock).mock.calls[0][0];
    expect(args.useResponsesApi).toBe(true);
    expect(args.reasoning).toEqual({ effort: "high" });
    expect(args.reasoningEffort).toBeUndefined();
  });

  it("uses the Responses API for OpenAI reasoning models even without an effort", async () => {
    // The API choice must not flip based on effort — an empty effort still routes through
    // Responses, just without a reasoning param (model reasons at its default level).
    await createModelInstance(JSON.stringify({ id: "gpt-5.5", provider: "OpenAI" }), "");
    const args = (ChatOpenAI as unknown as jest.Mock).mock.calls[0][0];
    expect(args.useResponsesApi).toBe(true);
    expect(args.reasoning).toBeUndefined();
  });

  it("does not set a thinking level for Google (Gemini effort disabled)", async () => {
    // The installed google-genai lacks Gemini 3.x levels (no "minimal"); forwarding them
    // would send invalid requests, so Google models get no thinkingConfig even with effort.
    await createModelInstance(JSON.stringify({ id: "gemini-3.5-flash", provider: "Google" }), "minimal");
    const args = (ChatGoogleGenerativeAI as unknown as jest.Mock).mock.calls[0][0];
    expect(args.thinkingConfig).toBeUndefined();
  });

  it("omits effort params when effort is empty/undefined", async () => {
    await createModelInstance(JSON.stringify({ id: "claude-sonnet-5", provider: "Anthropic" }), "");
    const args = (ChatAnthropic as unknown as jest.Mock).mock.calls[0][0];
    expect(args.outputConfig).toBeUndefined();
  });

  it("should throw an error for unsupported providers", async () => {
    const llmId = JSON.stringify({ id: "unknown", provider: "Unsupported" });

    await expect(() => createModelInstance(llmId)).rejects.toThrow("Unsupported LLM provider: Unsupported");
  });
});

describe("createModelInstance temperature handling", () => {
  // Reasoning models (gpt-5 family, o-series) only accept the default temperature, and the
  // Responses API can reject the parameter outright — so they are built with no temperature
  // at all (undefined is omitted from the request) and routed through the Responses API.
  it.each(["gpt-5.5", "gpt-5.4", "gpt-5.4-nano", "o3-mini", "o1"])(
    "builds reasoning OpenAI model %s with no temperature and the Responses API",
    async (id) => {
      await createModelInstance(JSON.stringify({ id, provider: "OpenAI" }));
      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ model: id, useResponsesApi: true })
      );
      const args = (ChatOpenAI as unknown as jest.Mock).mock.calls[0][0];
      expect(args.temperature).toBeUndefined();
    }
  );

  it.each(["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"])(
    "builds non-reasoning OpenAI model %s with temperature 0 on Chat Completions",
    async (id) => {
      await createModelInstance(JSON.stringify({ id, provider: "OpenAI" }));
      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ model: id, temperature: 0 })
      );
      const args = (ChatOpenAI as unknown as jest.Mock).mock.calls[0][0];
      expect(args.useResponsesApi).toBeUndefined();
    }
  );
});

describe("getOrCreateModelInstance", () => {
  it("should bind OpenAI models with parallel_tool_calls disabled", async () => {
    const llmId = JSON.stringify({ id: "gpt-4o", provider: "OpenAI" });
    await getOrCreateModelInstance(llmId);

    const mockInstance = (ChatOpenAI as unknown as jest.Mock).mock.results[0].value;
    expect(mockInstance.bindTools).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ parallel_tool_calls: false })
    );
  });

  it("should bind Google models with parallel_tool_calls disabled", async () => {
    const llmId = JSON.stringify({ id: "gemini-2.0-flash", provider: "Google" });
    await getOrCreateModelInstance(llmId);

    const mockInstance = (ChatGoogleGenerativeAI as unknown as jest.Mock).mock.results[0].value;
    expect(mockInstance.bindTools).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ parallel_tool_calls: false })
    );
  });

  it("should bind Anthropic models with disable_parallel_tool_use in tool_choice", async () => {
    const llmId = JSON.stringify({ id: "claude-sonnet-4-6", provider: "Anthropic" });
    await getOrCreateModelInstance(llmId);

    const mockInstance = (ChatAnthropic as unknown as jest.Mock).mock.results[0].value;
    expect(mockInstance.bindTools).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        tool_choice: { type: "auto", disable_parallel_tool_use: true }
      })
    );
    expect(mockInstance.bindTools).toHaveBeenCalledWith(
      expect.any(Array),
      expect.not.objectContaining({ parallel_tool_calls: expect.anything() })
    );
  });
});

describe("buildResponse usage passthrough", () => {
  it("attaches usage_metadata to plain responses", async () => {
    const message: any = { content: "hi", usage_metadata: {
      input_tokens: 100, output_tokens: 5, input_token_details: { cache_read: 80, cache_creation: 0 } } };
    const out: any = await buildResponse(message);
    expect(out.response).toBe("hi");
    expect(out.usage).toEqual(message.usage_metadata);
  });

  it("omits usage when the message has none", async () => {
    const out: any = await buildResponse({ content: "hi" } as any);
    expect(out.usage).toBeUndefined();
  });
});
