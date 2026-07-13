// Env-guarded scripted agent for TRANSPORT testing only (DAVAI_FAKE_AGENT=1).
// Lets us exercise the /ws streaming + tool round-trip protocol end-to-end without
// a provider API key. Never used unless the env flag is set; has no effect on real
// agent behavior or parity.

import type { TurnInput } from "./types.js";
import type { RunTurnOpts } from "./runner.js";

const stream = async (onToken: RunTurnOpts["onToken"], parts: string[]) => {
  let acc = "";
  for (const p of parts) {
    acc += p;
    onToken?.(acc);
    await new Promise((r) => setTimeout(r, 5));
  }
  return acc;
};

export async function fakeTurn(input: TurnInput, opts: RunTurnOpts = {}): Promise<any> {
  if (input.kind === "tool") {
    const content = typeof input.message.content === "string" ? input.message.content : "ok";
    const text = await stream(opts.onToken, ["Thanks", " — ", "done."]);
    return { response: `${text} (tool result: ${content})` };
  }

  // A message whose text is exactly "tooltest" triggers a tool-call round-trip.
  if (input.message === "tooltest") {
    await stream(opts.onToken, ["Let me ", "check the ", "document…"]);
    return {
      status: "requires_action",
      request: { action: "get", resource: "dataContextList" },
      tool_call_id: "call_fake_1",
      type: "create_request",
    };
  }

  const text = await stream(opts.onToken, ["Hello", ", ", "world."]);
  return { response: text };
}
