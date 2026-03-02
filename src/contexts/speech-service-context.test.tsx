import React from "react";
import { render, screen, act } from "@testing-library/react";
import { SpeechServiceProvider, useSpeechService, useIsSpeaking } from "./speech-service-context";
import { AppConfigContext, AppConfigProvider } from "./app-config-context";
import { AriaLiveProvider, useAriaLive } from "./aria-live-context";
import { setupMockSpeechSynthesis, cleanupMockSpeechSynthesis } from "../test-utils/mock-speech-synthesis";
import { AppConfigModel, AppConfigModelSnapshot } from "../models/app-config-model";
import { mockAppConfig } from "../test-utils/mock-app-config";

describe("SpeechServiceContext", () => {
  beforeEach(() => {
    setupMockSpeechSynthesis();
  });

  afterEach(() => {
    cleanupMockSpeechSynthesis();
  });

  const TestProviders = ({ children }: { children: React.ReactNode }) => (
    <AppConfigProvider>
      <AriaLiveProvider>
        <SpeechServiceProvider>
          {children}
        </SpeechServiceProvider>
      </AriaLiveProvider>
    </AppConfigProvider>
  );

  describe("SpeechServiceProvider", () => {
    it("renders children", () => {
      render(
        <TestProviders>
          <div data-testid="child">Child content</div>
        </TestProviders>
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });

    it("speaks when ariaLiveText changes", () => {
      jest.useFakeTimers();
      const mockSynth = setupMockSpeechSynthesis();
      const appConfig = AppConfigModel.create({
        ...mockAppConfig,
        readAloudEnabled: true,
      } as AppConfigModelSnapshot);
      const TestComponent = () => {
        const { setAriaLiveText } = useAriaLive();
        return (
          <button onClick={() => setAriaLiveText("Test message")}>
            Set Text
          </button>
        );
      };
      render(
        <AppConfigContext.Provider value={appConfig}>
          <AriaLiveProvider>
            <SpeechServiceProvider>
              <TestComponent />
            </SpeechServiceProvider>
          </AriaLiveProvider>
        </AppConfigContext.Provider>
      );
      act(() => {
        screen.getByRole("button").click();
      });
      // Advance past the 100ms debounce in SpeechServiceProvider
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(mockSynth.speak).toHaveBeenCalledTimes(1);
      const utterance = mockSynth.speak.mock.calls[0][0];
      expect(utterance.text).toBe("Test message");
      jest.useRealTimers();
    });
  });

  describe("useSpeechService", () => {
    it("throws error when used outside provider", () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Intentionally empty - suppress React error boundary logs
      });

      const TestComponent = () => {
        useSpeechService();
        return null;
      };

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useSpeechService must be used within a SpeechServiceProvider");

      consoleSpy.mockRestore();
    });

    it("returns speech service when used within provider", () => {
      let speechService: ReturnType<typeof useSpeechService> | null = null;

      const TestComponent = () => {
        speechService = useSpeechService();
        return null;
      };

      render(
        <TestProviders>
          <TestComponent />
        </TestProviders>
      );

      expect(speechService).not.toBeNull();
      expect(speechService).toHaveProperty("speak");
      expect(speechService).toHaveProperty("stopSpeech");
      expect(speechService).toHaveProperty("isSpeaking");
      expect(speechService).toHaveProperty("dispose");
    });
  });

  describe("useIsSpeaking", () => {
    it("throws error when used outside provider", () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {
        // Intentionally empty - suppress React error boundary logs
      });

      const TestComponent = () => {
        useIsSpeaking();
        return null;
      };

      expect(() => {
        render(<TestComponent />);
      }).toThrow("useIsSpeaking must be used within a SpeechServiceProvider");

      consoleSpy.mockRestore();
    });

    it("returns false initially", () => {
      let isSpeaking: boolean | null = null;

      const TestComponent = () => {
        isSpeaking = useIsSpeaking();
        return null;
      };

      render(
        <TestProviders>
          <TestComponent />
        </TestProviders>
      );

      expect(isSpeaking).toBe(false);
    });
  });
});
