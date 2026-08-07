// WebSocket transport for the AgentCore backend (P3). Replaces the 0.5-1s poll loop.
//
// Framework-free and injectable (pass WebSocketImpl in tests) so it can be unit
// tested without a browser or a live server. One persistent socket per transport
// instance (session-pinned); turns are sent serially (the model runs one at a time).
//
// Server frames: { type:"token", text } | { type:"result", output } |
//                { type:"error", error } | { type:"seeded", count }
// Client frames: a turn (message/tool) | { type:"seed", threadId, llmId, messages }

export interface WsTurnInput {
  kind?: "message" | "tool";
  llmId: string;
  threadId: string;
  message: any;
  dataContexts?: any[];
  graphs?: any[];
  effort?: string;
}

export interface SeedMessage {
  role: "user" | "assistant";
  content: string;
}

export interface WsTransportOptions {
  // Static endpoint (local backend container or dev bridge). Session id and auth
  // token are appended as query params.
  url?: string;
  authToken?: string;
  // Dynamic endpoint: called on every (re)connect to produce the URL — used for the
  // deployed AgentCore runtime, whose presigned URLs expire and embed the session id
  // in the signature. Exactly one of url/getConnectUrl must be provided.
  getConnectUrl?: (sessionId: string) => Promise<string>;
  // Injectable for tests; defaults to the global WebSocket.
  WebSocketImpl?: typeof WebSocket;
  // Called when a turn opens a FRESH socket after prior turns (i.e. the microVM
  // likely idled out). Return the transcript to replay so the agent's context is
  // rebuilt server-side before the live turn runs. Return [] / undefined to skip.
  onReconnect?: () => SeedMessage[] | undefined;
  // Deadline for the WebSocket handshake (default 15s).
  connectTimeoutMs?: number;
  // No-progress budget for an in-flight turn/seed, reset by every server frame
  // (default 60s — mirrors the poll path's idle budget). On expiry the pending
  // operation rejects and the socket is reset so the next turn reconnects.
  turnIdleTimeoutMs?: number;
}

// AgentCore's data plane caps WebSocket frames (32 KB per the service docs' stricter
// figure). Frames whose JSON exceeds CHUNK_CHARS characters are split into
// { type:"chunk", data, last? } envelopes and reassembled on the far side. 8000 UTF-16
// chars can encode to at most ~24 KB of UTF-8, comfortably under the cap.
export const CHUNK_CHARS = 8000;

// Ceiling for a reassembled inbound message (mirrors MAX_REASSEMBLED_CHARS in
// backend/src/ws.ts): a misbehaving server must not grow the buffer without bound.
export const MAX_REASSEMBLED_CHARS = 2 * 1024 * 1024;

export function* chunkFrameJson(json: string): Generator<string> {
  if (json.length <= CHUNK_CHARS) {
    yield json;
    return;
  }
  for (let i = 0; i < json.length; i += CHUNK_CHARS) {
    const piece = json.slice(i, i + CHUNK_CHARS);
    const last = i + CHUNK_CHARS >= json.length;
    yield JSON.stringify(last ? { type: "chunk", data: piece, last: true } : { type: "chunk", data: piece });
  }
}

// AgentCore runtimeSessionId must be >= 33 chars and use only [A-Za-z0-9_-]
// (the data plane currently accepts more, but stay within the documented charset).
// Derive one from the client's threadId that is stable (same thread -> same
// session, so reconnects re-pin the same VM). Collisions are not a practical
// concern: client threadIds are fixed-length nanoids, so equal padded IDs imply
// equal threadIds.
export function deriveSessionId(threadId: string): string {
  if (threadId.length >= 33) return threadId;
  return `${threadId}-`.padEnd(33, "0");
}

type Pending =
  | { kind: "turn"; onToken?: (text: string) => void; resolve: (o: any) => void; reject: (e: Error) => void }
  | { kind: "seed"; resolve: (o: any) => void; reject: (e: Error) => void };

export class WsTransport {
  private opts: WsTransportOptions;
  private WS: typeof WebSocket;
  private socket: WebSocket | null = null;
  private pending: Pending | null = null;
  private turnCount = 0;
  private chunkBuffer = "";
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: WsTransportOptions) {
    this.opts = opts;
    this.WS = opts.WebSocketImpl ?? (globalThis as any).WebSocket;
    if (!this.WS) throw new Error("No WebSocket implementation available");
    if (!opts.url === !opts.getConnectUrl) {
      throw new Error("WsTransport needs exactly one of url or getConnectUrl");
    }
  }

  // Reject and clear the in-flight operation (turn or seed), stopping its idle timer.
  private failPending(message: string): void {
    this.clearIdle();
    const p = this.pending;
    this.pending = null;
    p?.reject(new Error(message));
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // (Re)arm the no-progress budget for the in-flight operation.
  private armIdle(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const socket = this.socket;
      this.socket = null;
      this.failPending("Timed out waiting for a server response");
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    }, this.opts.turnIdleTimeoutMs ?? 60_000);
  }

  private async connectUrl(threadId: string): Promise<string> {
    const sid = deriveSessionId(threadId);
    if (this.opts.getConnectUrl) return this.opts.getConnectUrl(sid);
    const base = this.opts.url ?? ""; // constructor enforces url when getConnectUrl is absent
    const sep = base.includes("?") ? "&" : "?";
    let u = `${base}${sep}session=${encodeURIComponent(sid)}`;
    if (this.opts.authToken) u += `&token=${encodeURIComponent(this.opts.authToken)}`;
    return u;
  }

  // Ensure an OPEN socket. Returns true if a NEW socket was opened this call.
  private async ensureOpen(threadId: string): Promise<boolean> {
    if (this.socket && this.socket.readyState === this.WS.OPEN) {
      return false;
    }
    const url = await this.connectUrl(threadId);
    return new Promise<boolean>((resolve, reject) => {
      const socket = new this.WS(url);
      this.socket = socket;
      // Settle the handshake exactly once: open resolves; error, pre-open close,
      // or the connect deadline reject (and the socket is discarded).
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        fn();
      };
      const connectTimer = setTimeout(() => {
        if (this.socket === socket) this.socket = null;
        settle(() => reject(new Error("WebSocket connect timed out")));
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }, this.opts.connectTimeoutMs ?? 15_000);
      socket.onopen = () => settle(() => resolve(true));
      socket.onerror = () => {
        this.failPending("WebSocket error");
        settle(() => reject(new Error("WebSocket connection failed")));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        this.failPending("WebSocket closed mid-turn");
        settle(() => reject(new Error("WebSocket closed before opening")));
      };
      socket.onmessage = (ev: MessageEvent) => this.dispatch(ev);
    });
  }

  private dispatch(ev: MessageEvent) {
    let frame: any;
    try {
      frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch {
      return;
    }
    // Any server frame counts as progress for the idle budget.
    if (this.pending) this.armIdle();

    // Reassemble chunked frames (turns are serial, so one accumulator suffices).
    if (frame?.type === "chunk") {
      this.chunkBuffer += typeof frame.data === "string" ? frame.data : "";
      if (this.chunkBuffer.length > MAX_REASSEMBLED_CHARS) {
        this.chunkBuffer = "";
        const socket = this.socket;
        this.socket = null;
        this.failPending("Chunked server message too large");
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
        return;
      }
      if (!frame.last) return;
      const joined = this.chunkBuffer;
      this.chunkBuffer = "";
      try {
        frame = JSON.parse(joined);
      } catch {
        return;
      }
    }
    const p = this.pending;
    if (!p) return;

    if (frame.type === "error") {
      this.clearIdle();
      this.pending = null;
      p.reject(new Error(frame.error || "server error"));
      return;
    }
    if (p.kind === "turn") {
      if (frame.type === "token") {
        p.onToken?.(frame.text ?? "");
      } else if (frame.type === "result") {
        this.clearIdle();
        this.pending = null;
        p.resolve(frame.output);
      }
    } else if (p.kind === "seed") {
      if (frame.type === "seeded") {
        this.clearIdle();
        this.pending = null;
        p.resolve(frame);
      }
    }
  }

  private sendFrame(obj: unknown): void {
    if (!this.socket || this.socket.readyState !== this.WS.OPEN) {
      throw new Error("socket not open");
    }
    for (const wire of chunkFrameJson(JSON.stringify(obj))) {
      this.socket.send(wire);
    }
  }

  private sendSeed(threadId: string, llmId: string, messages: SeedMessage[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pending = { kind: "seed", resolve, reject };
      this.sendFrame({ type: "seed", threadId, llmId, messages });
      this.armIdle();
    });
  }

  /**
   * Run one turn. Streams token text via onToken and resolves with the terminal
   * output ({ response } or a { status:"requires_action", ... } payload) — the same
   * shape the poll loop produced, so caller logic is unchanged. Tool round-trips are
   * just a subsequent runTurn({ kind:"tool", ... }) on the same socket.
   */
  async runTurn(input: WsTurnInput, handlers: { onToken?: (text: string) => void } = {}): Promise<any> {
    // Turns are serial by contract (the assistant model enforces this); reject rather
    // than silently overwrite `pending`, which would strand the first caller's promise.
    if (this.pending) {
      throw new Error("A turn is already in flight on this transport");
    }
    const fresh = await this.ensureOpen(input.threadId);

    // Idle re-seed: a fresh socket after prior turns means the microVM was recycled;
    // replay the transcript so server-side context is rebuilt before this turn.
    if (fresh && this.turnCount > 0 && this.opts.onReconnect) {
      const seed = this.opts.onReconnect();
      if (seed && seed.length) {
        await this.sendSeed(input.threadId, input.llmId, seed);
      }
    }

    this.turnCount++;
    return new Promise((resolve, reject) => {
      this.pending = { kind: "turn", onToken: handlers.onToken, resolve, reject };
      try {
        this.sendFrame(input);
        this.armIdle();
      } catch (e) {
        this.pending = null;
        reject(e as Error);
      }
    });
  }

  cancel(): void {
    if (this.socket && this.socket.readyState === this.WS.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: "cancel" }));
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    // Reject (not abandon) any in-flight operation so awaiting callers resume.
    this.failPending("WebSocket transport closed");
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }
}
