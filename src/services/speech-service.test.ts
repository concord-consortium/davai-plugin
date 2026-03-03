import { SpeechService } from "./speech-service";
import { setupMockSpeechSynthesis, cleanupMockSpeechSynthesis, MockSpeechSynthesis } from "../test-utils/mock-speech-synthesis";

describe("SpeechService", () => {
  let mockSpeechSynthesis: MockSpeechSynthesis;
  let service: SpeechService;

  beforeEach(() => {
    mockSpeechSynthesis = setupMockSpeechSynthesis();
  });

  afterEach(() => {
    service?.dispose();
    cleanupMockSpeechSynthesis();
  });

  describe("speak", () => {
    it("does not speak when readAloudEnabled is false", () => {
      service = new SpeechService(() => false, () => 1);
      service.speak("Hello world");
      expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
    });

    it("speaks when readAloudEnabled is true", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello world");
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
    });

    it("does not speak empty text", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("");
      expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
    });

    it("does not speak whitespace-only text", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("   ");
      expect(mockSpeechSynthesis.speak).not.toHaveBeenCalled();
    });

    it("applies playback speed to utterance rate", () => {
      service = new SpeechService(() => true, () => 1.5);
      service.speak("Hello world");
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      expect(utterance.rate).toBe(1.5);
    });

    it("cancels previous speech before speaking new text", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("First message");
      service.speak("Second message");
      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(mockSpeechSynthesis.speak).toHaveBeenCalledTimes(2);
    });
  });

  describe("stopSpeech", () => {
    it("calls speechSynthesis.cancel", () => {
      service = new SpeechService(() => true, () => 1);
      service.stopSpeech();
      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    });

    it("sets speaking to false", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      // Simulate onstart callback
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);
      expect(service.isSpeaking()).toBe(true);

      service.stopSpeech();
      expect(service.isSpeaking()).toBe(false);
    });
  });

  describe("isSpeaking", () => {
    it("returns false initially", () => {
      service = new SpeechService(() => true, () => 1);
      expect(service.isSpeaking()).toBe(false);
    });

    it("returns true after onstart fires", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);
      expect(service.isSpeaking()).toBe(true);
    });

    it("returns false after onend fires", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);
      utterance.onend?.({} as Event);
      expect(service.isSpeaking()).toBe(false);
    });

    it("returns false after onerror fires", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);
      utterance.onerror?.({} as Event);
      expect(service.isSpeaking()).toBe(false);
    });
  });

  describe("escape key handler", () => {
    it("stops speech when Escape is pressed and speaking", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);

      const event = new KeyboardEvent("keydown", { code: "Escape", key: "Escape" });
      Object.defineProperty(event, "target", { value: document.body });
      const preventDefaultSpy = jest.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    });

    it("stops speech when Escape is pressed in input element while speaking", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);

      const inputElement = document.createElement("input");
      const event = new KeyboardEvent("keydown", { code: "Escape", key: "Escape" });
      Object.defineProperty(event, "target", { value: inputElement });
      const preventDefaultSpy = jest.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    });

    it("stops speech when Escape is pressed in textarea element while speaking", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);

      const textareaElement = document.createElement("textarea");
      const event = new KeyboardEvent("keydown", { code: "Escape", key: "Escape" });
      Object.defineProperty(event, "target", { value: textareaElement });
      const preventDefaultSpy = jest.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
    });

    it("does not intercept Escape when not speaking", () => {
      service = new SpeechService(() => true, () => 1);

      const event = new KeyboardEvent("keydown", { code: "Escape", key: "Escape" });
      Object.defineProperty(event, "target", { value: document.body });
      const preventDefaultSpy = jest.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it("does not stop speech when other keys are pressed", () => {
      service = new SpeechService(() => true, () => 1);
      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);

      const event = new KeyboardEvent("keydown", { code: "Space", key: " " });
      Object.defineProperty(event, "target", { value: document.body });
      const preventDefaultSpy = jest.spyOn(event, "preventDefault");

      window.dispatchEvent(event);

      // Spacebar should not stop speech anymore - only Escape does
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe("onSpeakingChange", () => {
    it("calls callback when speaking state changes", () => {
      service = new SpeechService(() => true, () => 1);
      const callback = jest.fn();
      service.onSpeakingChange(callback);

      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);

      expect(callback).toHaveBeenCalledWith(true);

      utterance.onend?.({} as Event);
      expect(callback).toHaveBeenCalledWith(false);
    });

    it("returns unsubscribe function", () => {
      service = new SpeechService(() => true, () => 1);
      const callback = jest.fn();
      const unsubscribe = service.onSpeakingChange(callback);

      unsubscribe();

      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("calls error callback when speech synthesis is not available", () => {
      cleanupMockSpeechSynthesis();
      const onError = jest.fn();
      service = new SpeechService(() => true, () => 1, onError);
      service.speak("Hello");

      expect(onError).toHaveBeenCalledWith("Speech synthesis is not available in this browser.");
    });

    it("calls error callback on speech error (non-canceled)", () => {
      const onError = jest.fn();
      service = new SpeechService(() => true, () => 1, onError);
      service.speak("Hello");

      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent);

      expect(onError).toHaveBeenCalledWith("Speech synthesis error: network");
    });

    it("does not call error callback on canceled error", () => {
      const onError = jest.fn();
      service = new SpeechService(() => true, () => 1, onError);
      service.speak("Hello");

      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onerror?.({ error: "canceled" } as SpeechSynthesisErrorEvent);

      expect(onError).not.toHaveBeenCalled();
    });

    it("does not call error callback on interrupted error", () => {
      const onError = jest.fn();
      service = new SpeechService(() => true, () => 1, onError);
      service.speak("Hello");

      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("stops speech and removes event listener", () => {
      const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
      service = new SpeechService(() => true, () => 1);
      service.dispose();
      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });

    it("clears speaking change callbacks", () => {
      service = new SpeechService(() => true, () => 1);
      const callback = jest.fn();
      service.onSpeakingChange(callback);

      service.speak("Hello");
      const utterance = mockSpeechSynthesis.speak.mock.calls[0][0];
      utterance.onstart?.({} as Event);
      expect(callback).toHaveBeenCalledWith(true);
      callback.mockClear();

      service.dispose();
      callback.mockClear();

      // callback should not be called since it was cleared
      utterance.onstart?.({} as Event);
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
