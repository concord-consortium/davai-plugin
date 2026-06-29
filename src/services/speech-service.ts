/**
 * SpeechService provides text-to-speech functionality using the browser's
 * Web Speech API (speechSynthesis). It reads text aloud based on user settings.
 */
export interface ISpeechService {
  speak(text: string): void;
  stopSpeech(): void;
  stopAndSuppress(): void;
  isSpeaking(): boolean;
  dispose(): void;
  onSpeakingChange(callback: (speaking: boolean) => void): () => void;
  enqueue(text: string): void;
  speakIfIdle(text: string): void;
  resumeSpeech(): void;
}

export class SpeechService implements ISpeechService {
  private utterance: SpeechSynthesisUtterance | null = null;
  private queue: string[] = [];
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private speaking = false;
  // Set by Escape: stop reading the rest of the current response. enqueue()/speakIfIdle()
  // become no-ops until resumeSpeech() (called when a new response starts) or an explicit
  // speak(). Without this, streamed chunks enqueued after Escape would resume reading.
  private suppressed = false;
  private speakingChangeCallbacks: Set<(speaking: boolean) => void> = new Set();
  private onErrorCallback: ((error: string) => void) | null = null;

  constructor(
    private getReadAloudEnabled: () => boolean,
    private getPlaybackSpeed: () => number,
    onError?: (error: string) => void
  ) {
    this.onErrorCallback = onError || null;
    this.setupEscapeHandler();
  }

  private setupEscapeHandler(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.code !== "Escape" && event.key !== "Escape") return;
      // Only act when something is being spoken or queued (so Escape passes through
      // for other uses otherwise).
      if (!this.speaking && this.queue.length === 0) return;
      event.preventDefault();
      this.stopAndSuppress(); // stop reading the rest of this response, not just the current chunk
    };

    window.addEventListener("keydown", this.keydownHandler);
    // DAVAI runs in an iframe; also listen on the parent so Escape works when focus is
    // in CODAP (mirrors the keyboard-shortcuts service). Guarded for cross-origin.
    if (window.parent && window.parent !== window) {
      try { window.parent.addEventListener("keydown", this.keydownHandler); } catch { /* cross-origin */ }
    }
  }

  // Re-enable speaking after an Escape suppression (called when a new response begins).
  resumeSpeech(): void {
    this.suppressed = false;
  }

  // Stop speaking AND suppress the rest of the current streamed response, so chunks
  // enqueued afterward don't resume playback. Used by both the Escape key and the
  // visible Stop button. A new response (resumeSpeech) or an explicit speak() lifts it.
  stopAndSuppress(): void {
    this.suppressed = true;
    this.stopSpeech();
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking !== value) {
      this.speaking = value;
      this.speakingChangeCallbacks.forEach(callback => callback(value));
    }
  }

  speak(text: string): void {
    // An interrupt discards any pending streamed chunks and clears Escape suppression
    // (an explicit announcement — error, replay, message — should always play).
    this.queue = [];
    this.utterance = null;
    this.suppressed = false;
    if (!this.getReadAloudEnabled()) {
      return;
    }
    if (typeof window === "undefined" || !window.speechSynthesis) {
      this.onErrorCallback?.("Speech synthesis is not available in this browser.");
      return;
    }
    if (!text || text.trim() === "") {
      return;
    }

    // Cancel any ongoing speech, then play through the SAME queue mechanism that
    // enqueue() uses (speakNext). This is what makes streamed chunks work: chunks
    // enqueued while this utterance is speaking would otherwise strand, because
    // enqueue() only starts speakNext when no utterance is active and speak()'s own
    // onend never advanced the queue. Routing speak() through speakNext means its
    // onend drains whatever was enqueued in the meantime.
    window.speechSynthesis.cancel();
    this.queue = [text];
    this.speakNext();
  }

  stopSpeech(): void {
    this.queue = [];
    this.utterance = null;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.setSpeaking(false);
  }

  // True when nothing is being spoken and the queue is empty.
  private isIdle(): boolean {
    return !this.utterance && this.queue.length === 0;
  }

  // Speak only if idle — used for the non-interrupting, looping "Processing"
  // announcement so it never cuts off streamed speech (it simply skips while
  // anything else is being spoken/queued, and resumes once idle).
  speakIfIdle(text: string): void {
    if (this.suppressed) return;
    if (this.isIdle()) this.speak(text);
  }

  enqueue(text: string): void {
    if (this.suppressed) return;
    if (!this.getReadAloudEnabled()) return;
    if (!text || text.trim() === "") return;
    if (typeof window === "undefined" || !window.speechSynthesis) {
      this.onErrorCallback?.("Speech synthesis is not available in this browser.");
      return;
    }
    this.queue.push(text);
    if (!this.utterance) this.speakNext();
  }

  private speakNext(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.utterance = null;
      this.setSpeaking(false); // drained
      return;
    }
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.rate = this.getPlaybackSpeed();
    this.utterance = utterance;
    utterance.onstart = () => { if (this.utterance === utterance) this.setSpeaking(true); };
    utterance.onend = () => { if (this.utterance === utterance) this.speakNext(); };
    utterance.onerror = (event) => {
      if (this.utterance === utterance && event.error !== "canceled" && event.error !== "interrupted") {
        this.onErrorCallback?.(`Speech synthesis error: ${event.error}`);
      }
      if (this.utterance === utterance) this.speakNext();
    };
    window.speechSynthesis.speak(utterance);
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  onSpeakingChange(callback: (speaking: boolean) => void): () => void {
    this.speakingChangeCallbacks.add(callback);
    return () => {
      this.speakingChangeCallbacks.delete(callback);
    };
  }

  dispose(): void {
    this.stopSpeech();
    this.speakingChangeCallbacks.clear();
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
      if (window.parent && window.parent !== window) {
        try { window.parent.removeEventListener("keydown", this.keydownHandler); } catch { /* cross-origin */ }
      }
      this.keydownHandler = null;
    }
  }
}
