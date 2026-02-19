/**
 * SpeechService provides text-to-speech functionality using the browser's
 * Web Speech API (speechSynthesis). It reads text aloud based on user settings.
 */
export interface ISpeechService {
  speak(text: string): void;
  stopSpeech(): void;
  isSpeaking(): boolean;
  dispose(): void;
  onSpeakingChange(callback: (speaking: boolean) => void): () => void;
}

export class SpeechService implements ISpeechService {
  private utterance: SpeechSynthesisUtterance | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private speaking = false;
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
      // Only handle Escape when speech is playing
      if (!this.speaking) return;

      if (event.code === "Escape" || event.key === "Escape") {
        event.preventDefault();
        this.stopSpeech();
      }
    };

    window.addEventListener("keydown", this.keydownHandler);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking !== value) {
      this.speaking = value;
      this.speakingChangeCallbacks.forEach(callback => callback(value));
    }
  }

  speak(text: string): void {
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

    // Cancel any ongoing speech (but don't call our stopSpeech which resets state)
    window.speechSynthesis.cancel();

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this.getPlaybackSpeed();

    this.utterance.onstart = () => {
      this.setSpeaking(true);
    };

    this.utterance.onend = () => {
      this.setSpeaking(false);
    };

    this.utterance.onerror = (event) => {
      this.setSpeaking(false);
      // Don't report errors for intentional cancellations (user pressed Escape or new speech started)
      if (event.error !== "canceled" && event.error !== "interrupted") {
        this.onErrorCallback?.(`Speech synthesis error: ${event.error}`);
      }
    };

    window.speechSynthesis.speak(this.utterance);
  }

  stopSpeech(): void {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.setSpeaking(false);
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
      this.keydownHandler = null;
    }
  }
}
