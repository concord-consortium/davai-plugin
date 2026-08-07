import { WsTransport, deriveSessionId, SeedMessage } from "./ws-transport";

// Minimal injectable mock WebSocket. Fires onopen on a microtask; server responses
// are scripted per sent frame via the static `onSend` hook.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static sent: any[] = [];
  static onSend: (frame: any, ws: MockWebSocket) => void = jest.fn();

  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }
  send(data: string) {
    const frame = JSON.parse(data);
    MockWebSocket.sent.push(frame);
    MockWebSocket.onSend(frame, this);
  }
  emit(obj: any) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const reset = () => {
  MockWebSocket.instances = [];
  MockWebSocket.sent = [];
  MockWebSocket.onSend = jest.fn();
};

const opts = (extra: any = {}) => ({
  url: "ws://test/ws",
  WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
  ...extra,
});

const baseTurn = { llmId: '{"id":"gpt-4o","provider":"OpenAI"}', threadId: "t-abc", message: "hi" };

describe("deriveSessionId", () => {
  it("pads short threadIds to exactly 33 chars, stably", () => {
    const s = deriveSessionId("t-abc");
    expect(s.length).toBe(33);
    expect(deriveSessionId("t-abc")).toBe(s); // stable
  });
  it("does not collide for distinct short threadIds", () => {
    expect(deriveSessionId("ab")).not.toBe(deriveSessionId("ab0"));
  });
  it("leaves >=33 char threadIds unchanged", () => {
    const long = "x".repeat(40);
    expect(deriveSessionId(long)).toBe(long);
  });
  it("uses only the documented AgentCore session-id charset", () => {
    // nanoid alphabet is A-Za-z0-9_- ; padding must not introduce anything else.
    expect(deriveSessionId("V1StGXR8_Z5jdHi6B-myT")).toMatch(/^[A-Za-z0-9_-]{33,100}$/);
  });
});

describe("WsTransport.runTurn", () => {
  beforeEach(reset);

  it("streams tokens and resolves with the result output", async () => {
    MockWebSocket.onSend = (_frame, ws) => {
      ws.emit({ type: "token", text: "He" });
      ws.emit({ type: "token", text: "Hello" });
      ws.emit({ type: "result", output: { response: "Hello" } });
    };
    const t = new WsTransport(opts());
    const tokens: string[] = [];
    const out = await t.runTurn(baseTurn, { onToken: (x) => tokens.push(x) });
    expect(tokens).toEqual(["He", "Hello"]);
    expect(out).toEqual({ response: "Hello" });
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("handles a tool round-trip on the SAME socket", async () => {
    MockWebSocket.onSend = (frame, ws) => {
      if (frame.kind === "tool") {
        ws.emit({ type: "result", output: { response: "done with tool" } });
      } else {
        ws.emit({ type: "result", output: { status: "requires_action", tool_call_id: "c1", request: {} } });
      }
    };
    const t = new WsTransport(opts());
    const first = await t.runTurn(baseTurn);
    expect(first.status).toBe("requires_action");
    const second = await t.runTurn({
      kind: "tool",
      llmId: baseTurn.llmId,
      threadId: baseTurn.threadId,
      message: { tool_call_id: first.tool_call_id, content: "[]" },
    });
    expect(second).toEqual({ response: "done with tool" });
    expect(MockWebSocket.instances.length).toBe(1); // reused, no new socket
  });

  it("rejects on an error frame", async () => {
    MockWebSocket.onSend = (_f, ws) => ws.emit({ type: "error", error: "boom" });
    const t = new WsTransport(opts());
    await expect(t.runTurn(baseTurn)).rejects.toThrow("boom");
  });

  it("re-seeds the transcript when a turn opens a fresh socket after prior turns", async () => {
    const history: SeedMessage[] = [
      { role: "user", content: "earlier q" },
      { role: "assistant", content: "earlier a" },
    ];
    MockWebSocket.onSend = (frame, ws) => {
      if (frame.type === "seed") return ws.emit({ type: "seeded", count: frame.messages.length });
      ws.emit({ type: "result", output: { response: "ok" } });
    };
    const t = new WsTransport(opts({ onReconnect: () => history }));

    await t.runTurn(baseTurn); // turn 1 on socket 1
    MockWebSocket.instances[0].close(); // microVM idles out
    await t.runTurn({ ...baseTurn, message: "again" }); // turn 2 -> fresh socket

    expect(MockWebSocket.instances.length).toBe(2);
    const seedFrame = MockWebSocket.sent.find((f) => f.type === "seed");
    expect(seedFrame).toBeTruthy();
    expect(seedFrame.messages).toEqual(history);
    // seed must precede the live turn frame in send order
    const seedIdx = MockWebSocket.sent.findIndex((f) => f.type === "seed");
    const turn2Idx = MockWebSocket.sent.findIndex((f) => f.message === "again");
    expect(seedIdx).toBeLessThan(turn2Idx);
  });

  it("does not re-seed on the first turn", async () => {
    MockWebSocket.onSend = (_f, ws) => ws.emit({ type: "result", output: { response: "ok" } });
    const t = new WsTransport(opts({ onReconnect: () => [{ role: "user", content: "x" }] }));
    await t.runTurn(baseTurn);
    expect(MockWebSocket.sent.find((f) => f.type === "seed")).toBeUndefined();
  });
});

describe("chunked frames", () => {
  beforeEach(reset);

  it("splits oversized outbound frames into chunk envelopes the server can rejoin", async () => {
    const big = "x".repeat(20_000);
    MockWebSocket.onSend = (frame, ws) => {
      if (frame.type === "chunk" && !frame.last) return; // accumulate silently
      ws.emit({ type: "result", output: { response: "ok" } });
    };
    const t = new WsTransport(opts());
    await t.runTurn({ ...baseTurn, message: big });
    const chunks = MockWebSocket.sent.filter((f) => f.type === "chunk");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1].last).toBe(true);
    // Rejoining the chunk data yields the original frame JSON
    const rejoined = JSON.parse(chunks.map((c) => c.data).join(""));
    expect(rejoined.message).toBe(big);
    // No oversized frame was ever put on the wire
    for (const f of MockWebSocket.sent) {
      expect(JSON.stringify(f).length).toBeLessThan(10_000);
    }
  });

  it("does not chunk small frames", async () => {
    MockWebSocket.onSend = (_f, ws) => ws.emit({ type: "result", output: { response: "ok" } });
    const t = new WsTransport(opts());
    await t.runTurn(baseTurn);
    expect(MockWebSocket.sent.filter((f) => f.type === "chunk")).toEqual([]);
  });

  it("reassembles inbound chunked frames into a single result", async () => {
    const bigResponse = "y".repeat(20_000);
    MockWebSocket.onSend = (_f, ws) => {
      const json = JSON.stringify({ type: "result", output: { response: bigResponse } });
      for (let i = 0; i < json.length; i += 8000) {
        const last = i + 8000 >= json.length;
        ws.emit(last ? { type: "chunk", data: json.slice(i, i + 8000), last: true }
                     : { type: "chunk", data: json.slice(i, i + 8000) });
      }
    };
    const t = new WsTransport(opts());
    const out = await t.runTurn(baseTurn);
    expect(out).toEqual({ response: bigResponse });
  });
});

describe("getConnectUrl mode", () => {
  beforeEach(reset);

  it("uses the async URL factory with the derived session id on every fresh connect", async () => {
    const urls: string[] = [];
    MockWebSocket.onSend = (frame, ws) => {
      if (frame.type === "seed") return ws.emit({ type: "seeded", count: frame.messages.length });
      ws.emit({ type: "result", output: { response: "ok" } });
    };
    const t = new WsTransport(opts({
      url: undefined,
      getConnectUrl: async (sessionId: string) => {
        urls.push(sessionId);
        return `wss://signed.example/ws?sid=${sessionId}`;
      },
      onReconnect: () => [{ role: "user", content: "earlier" }],
    }));
    await t.runTurn(baseTurn);
    MockWebSocket.instances[0].close(); // simulate idle-out
    await t.runTurn({ ...baseTurn, message: "again" });
    expect(urls).toEqual([deriveSessionId("t-abc"), deriveSessionId("t-abc")]);
    expect(MockWebSocket.instances.map((w) => w.url)).toEqual([
      `wss://signed.example/ws?sid=${deriveSessionId("t-abc")}`,
      `wss://signed.example/ws?sid=${deriveSessionId("t-abc")}`,
    ]);
  });
});

describe("failure and timeout handling", () => {
  beforeEach(reset);

  it("rejects the in-flight turn when close() is called", async () => {
    MockWebSocket.onSend = () => { /* server never answers */ };
    const t = new WsTransport(opts());
    const turn = t.runTurn(baseTurn);
    turn.catch(() => { /* observed below */ });
    await new Promise((r) => setTimeout(r, 0)); // let the handshake settle and the frame send
    t.close();
    await expect(turn).rejects.toThrow("WebSocket transport closed");
  });

  it("rejects a turn that gets no server frames within the idle budget", async () => {
    MockWebSocket.onSend = () => { /* server never answers */ };
    const t = new WsTransport(opts({ turnIdleTimeoutMs: 25 }));
    await expect(t.runTurn(baseTurn)).rejects.toThrow("Timed out waiting for a server response");
  });

  it("token frames reset the idle budget", async () => {
    MockWebSocket.onSend = (_f, ws) => {
      // Stream tokens every 15ms (inside the 40ms budget), finish after 4 of them.
      let n = 0;
      const timer = setInterval(() => {
        n++;
        ws.emit({ type: "token", text: "t".repeat(n) });
        if (n === 4) {
          clearInterval(timer);
          ws.emit({ type: "result", output: { response: "tttt" } });
        }
      }, 15);
    };
    const t = new WsTransport(opts({ turnIdleTimeoutMs: 40 }));
    const out = await t.runTurn(baseTurn);
    expect(out).toEqual({ response: "tttt" });
  });

  it("rejects the connect when the socket closes before opening", async () => {
    class ClosesBeforeOpenWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((ev: any) => void) | null = null;
      constructor(_url: string) {
        queueMicrotask(() => {
          this.readyState = ClosesBeforeOpenWebSocket.CLOSED;
          this.onclose?.(); // e.g. a 403 handshake rejection — open never fires
        });
      }
      close() { this.readyState = ClosesBeforeOpenWebSocket.CLOSED; }
      send() { throw new Error("not open"); }
    }
    const t = new WsTransport(opts({ WebSocketImpl: ClosesBeforeOpenWebSocket as unknown as typeof WebSocket }));
    await expect(t.runTurn(baseTurn)).rejects.toThrow("WebSocket closed before opening");
  });

  it("rejects the connect after the connect timeout", async () => {
    class NeverConnectsWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((ev: any) => void) | null = null;
      close() { this.readyState = 3; }
      send() { /* never open */ }
    }
    const t = new WsTransport(opts({
      WebSocketImpl: NeverConnectsWebSocket as unknown as typeof WebSocket,
      connectTimeoutMs: 25,
    }));
    await expect(t.runTurn(baseTurn)).rejects.toThrow("WebSocket connect timed out");
  });

  it("rejects construction with both url and getConnectUrl, or neither", () => {
    expect(() => new WsTransport(opts({ getConnectUrl: async () => "wss://x" })))
      .toThrow("exactly one");
    expect(() => new WsTransport(opts({ url: undefined }))).toThrow("exactly one");
  });
});

describe("WsTransport.cancel", () => {
  beforeEach(reset);

  it("sends a cancel frame on the open socket while a turn is in flight", async () => {
    const t = new WsTransport(opts());
    // Script the server: when the turn frame arrives, the client cancels mid-turn and
    // the server acknowledges the abort with a cancelled result (mirrors backend ws.ts).
    MockWebSocket.onSend = (frame, ws) => {
      if (frame.message === "hi") {
        t.cancel();
        ws.emit({ type: "result", output: { status: "cancelled" } });
      }
    };
    const out = await t.runTurn(baseTurn);
    expect(MockWebSocket.sent).toContainEqual({ type: "cancel" });
    expect(out).toEqual({ status: "cancelled" });
  });

  it("is a no-op when no socket is open", () => {
    const t = new WsTransport(opts());
    expect(() => t.cancel()).not.toThrow();
    expect(MockWebSocket.sent).toEqual([]);
  });
});
