import { loadCueBuffers, playCue, cancelAllCues, disposeCuePlayer } from "./cue-audio-player";

// Mock AudioBufferSourceNode
const createMockSourceNode = () => {
  return {
    buffer: null as AudioBuffer | null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    onended: null as (() => void) | null,
  };
};

// Mock AudioContext and related Web Audio API objects
const createMockAudioContext = (state: AudioContextState = "running") => {
  const mockGainNode = {
    gain: { value: 1 },
    connect: jest.fn(),
  };
  const sourceNodes: ReturnType<typeof createMockSourceNode>[] = [];
  const ctx = {
    state,
    resume: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    createGain: jest.fn().mockReturnValue(mockGainNode),
    createBufferSource: jest.fn(() => {
      const node = createMockSourceNode();
      sourceNodes.push(node);
      return node;
    }),
    decodeAudioData: jest.fn().mockResolvedValue({ duration: 0.5 } as AudioBuffer),
    destination: {},
  };
  return { ctx, mockGainNode, sourceNodes };
};

// Mock fetch to return an ArrayBuffer
const mockFetchSuccess = () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
};

const originalFetch = global.fetch;

beforeEach(() => {
  disposeCuePlayer();
  global.fetch = jest.fn();
  jest.spyOn(console, "warn").mockImplementation(() => { /* no-op */ });
});

afterEach(() => {
  disposeCuePlayer();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  delete (window as any).AudioContext;
  delete (window as any).webkitAudioContext;
});

describe("loadCueBuffers", () => {
  it("fetches and decodes all 5 MP3 files", async () => {
    const { ctx } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();

    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(5);
  });

  it("is idempotent — second call does not re-fetch", async () => {
    const { ctx } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    await loadCueBuffers();

    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it("calls audioContext.resume() when context is suspended", async () => {
    const { ctx } = createMockAudioContext("suspended");
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();

    expect(ctx.resume).toHaveBeenCalled();
  });

  it("does not call resume() when context is already running", async () => {
    const { ctx } = createMockAudioContext("running");
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("degrades silently when AudioContext is unavailable", async () => {
    // Neither AudioContext nor webkitAudioContext defined
    await loadCueBuffers();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("AudioContext not available")
    );
  });

  it("logs a warning and continues when an individual file fails to load", async () => {
    const { ctx } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);

    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("network error"));
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    });

    await loadCueBuffers();

    // All 5 fetched, 1 failed, 4 decoded
    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("cue-audio-player: failed to load"),
      expect.any(Error)
    );
  });

  it("logs a warning when fetch returns a non-ok response", async () => {
    const { ctx } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);

    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({ ok: false, status: 404 });
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    });

    await loadCueBuffers();

    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("cue-audio-player: failed to load"),
      expect.objectContaining({ message: expect.stringContaining("HTTP 404") })
    );
  });

  it("falls back to webkitAudioContext when AudioContext is unavailable", async () => {
    const { ctx } = createMockAudioContext();
    (window as any).webkitAudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();

    expect(global.fetch).toHaveBeenCalledTimes(5);
  });
});

describe("playCue", () => {
  it("creates a source node, connects to gain, and starts playback", async () => {
    const { ctx, mockGainNode, sourceNodes } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    playCue("mean");

    expect(sourceNodes).toHaveLength(1);
    const source = sourceNodes[0];
    expect(source.buffer).toEqual({ duration: 0.5 });
    expect(source.connect).toHaveBeenCalledWith(mockGainNode);
    expect(source.start).toHaveBeenCalled();
  });

  it("is a silent no-op when buffers have not been loaded", () => {
    // No loadCueBuffers() called
    expect(() => playCue("mean")).not.toThrow();
  });

  it("is a silent no-op for an unknown label after load", async () => {
    const { ctx, sourceNodes } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    playCue("nonexistent" as any);

    expect(sourceNodes).toHaveLength(0);
  });

  it("removes source from active set after onended fires", async () => {
    const { ctx, sourceNodes } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    playCue("mean");

    // Simulate natural playback end
    sourceNodes[0].onended?.();

    // cancelAllCues should not attempt to stop the already-ended source
    cancelAllCues();
    expect(sourceNodes[0].stop).not.toHaveBeenCalled();
  });

  it("can create and start multiple cues without interference", async () => {
    const { ctx, sourceNodes } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    playCue("mean");
    playCue("median");
    playCue("end");

    expect(sourceNodes).toHaveLength(3);
    sourceNodes.forEach((s) => expect(s.start).toHaveBeenCalled());
  });
});

describe("cancelAllCues", () => {
  it("stops all active source nodes", async () => {
    const { ctx, sourceNodes } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    playCue("mean");
    playCue("median");

    cancelAllCues();

    expect(sourceNodes[0].stop).toHaveBeenCalled();
    expect(sourceNodes[1].stop).toHaveBeenCalled();
  });

  it("is safe to call when no cues are playing", () => {
    expect(() => cancelAllCues()).not.toThrow();
  });
});

describe("disposeCuePlayer", () => {
  it("closes the AudioContext and resets state", async () => {
    const { ctx } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx);
    mockFetchSuccess();

    await loadCueBuffers();
    disposeCuePlayer();

    expect(ctx.close).toHaveBeenCalled();

    // After dispose, playCue is a no-op
    expect(() => playCue("mean")).not.toThrow();
  });

  it("allows re-initialization after dispose", async () => {
    const { ctx: ctx1 } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx1);
    mockFetchSuccess();

    await loadCueBuffers();
    disposeCuePlayer();

    // Re-create mock for second load
    const { ctx: ctx2 } = createMockAudioContext();
    (window as any).AudioContext = jest.fn(() => ctx2);
    mockFetchSuccess();

    await loadCueBuffers();

    expect(ctx2.decodeAudioData).toHaveBeenCalledTimes(5);
  });
});
