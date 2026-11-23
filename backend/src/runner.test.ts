// buildResponse never touches the model, so the LangGraph app (and the provider
// clients it would build) is mocked out entirely.
jest.mock("./agent/utils/llm-utils", () => ({
  getLangApp: jest.fn(),
}));

import { buildResponse } from "./runner";

describe("buildResponse usage passthrough", () => {
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
    const out: any = await buildResponse({ content: "hi" });
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
