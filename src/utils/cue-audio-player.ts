import meanUrl from "../assets/audio/mean.mp3";
import medianUrl from "../assets/audio/median.mp3";
import sdLowerUrl from "../assets/audio/sd-lower.mp3";
import sdUpperUrl from "../assets/audio/sd-upper.mp3";
import endUrl from "../assets/audio/end.mp3";

export type CueLabel = "mean" | "median" | "SD lower" | "SD upper" | "end";

const cueUrls: Record<CueLabel, string> = {
  "mean": meanUrl,
  "median": medianUrl,
  "SD lower": sdLowerUrl,
  "SD upper": sdUpperUrl,
  "end": endUrl,
};

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let buffers: Map<CueLabel, AudioBuffer> | null = null;
let loadPromise: Promise<void> | null = null;
const activeSources = new Set<AudioBufferSourceNode>();

/**
 * Creates the AudioContext and decodes all MP3 cue files into AudioBuffers.
 * Idempotent — subsequent calls return immediately without re-fetching.
 */
export async function loadCueBuffers(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      console.warn("cue-audio-player: AudioContext not available, cues will be silent");
      return;
    }

    audioContext = new AudioCtx();
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0.75;
    gainNode.connect(audioContext.destination);

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    buffers = new Map();
    const labels = Object.keys(cueUrls) as CueLabel[];
    await Promise.all(
      labels.map(async (label) => {
        try {
          if (!audioContext || !buffers) return;
          // Capture into locals so references stay valid if disposeCuePlayer()
          // nulls the module-level variables during an await below.
          const ctx = audioContext;
          const bufs = buffers;
          const response = await fetch(cueUrls[label]);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching "${label}"`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          bufs.set(label, audioBuffer);
        } catch (err) {
          console.warn(`cue-audio-player: failed to load "${label}"`, err);
        }
      })
    );
  })().catch((err) => {
    if (audioContext) {
      audioContext.close().catch(() => { /* context may already be closed */ });
      audioContext = null;
    }
    gainNode = null;
    loadPromise = null; // allow a future retry
    throw err;
  });

  return loadPromise;
}

/**
 * Plays the MP3 clip for the given cue label immediately.
 * Silent no-op if buffers haven't loaded or the label has no buffer.
 */
export function playCue(label: CueLabel): void {
  if (!audioContext || !gainNode || !buffers) return;
  const buffer = buffers.get(label);
  if (!buffer) return;

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(gainNode);

  activeSources.add(source);
  source.onended = () => {
    activeSources.delete(source);
  };

  source.start();
}

/**
 * Stops all currently-playing cue clips.
 */
export function cancelAllCues(): void {
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      // Already stopped
    }
  }
  activeSources.clear();
}

/**
 * Tears down the AudioContext and releases all resources.
 */
export function disposeCuePlayer(): void {
  cancelAllCues();
  if (audioContext) {
    audioContext.close().catch(() => { /* context already closed or unavailable */ });
    audioContext = null;
  }
  gainNode = null;
  buffers = null;
  loadPromise = null;
}
