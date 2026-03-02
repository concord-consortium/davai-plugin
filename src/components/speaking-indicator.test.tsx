import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SpeakingIndicator } from "./speaking-indicator";
import { AppConfigContext } from "../contexts/app-config-context";
import { AppConfigModel, AppConfigModelSnapshot } from "../models/app-config-model";
import { SpeechServiceContext } from "../contexts/speech-service-context";
import { ISpeechService } from "../services/speech-service";
import { mockAppConfig } from "../test-utils/mock-app-config";

const createMockSpeechService = (): ISpeechService => ({
  speak: jest.fn(),
  stopSpeech: jest.fn(),
  isSpeaking: jest.fn(() => false),
  dispose: jest.fn(),
  onSpeakingChange: jest.fn(() => jest.fn()),
});

interface RenderOptions {
  readAloudEnabled?: boolean;
  isSpeaking?: boolean;
  currentSpeechText?: string | null;
  speechService?: ISpeechService;
}

const renderSpeakingIndicator = ({
  readAloudEnabled = false,
  isSpeaking = false,
  currentSpeechText = null,
  speechService,
}: RenderOptions = {}) => {
  const appConfig = AppConfigModel.create({
    ...mockAppConfig,
    readAloudEnabled,
  } as AppConfigModelSnapshot);
  const mockService = speechService ?? createMockSpeechService();

  render(
    <AppConfigContext.Provider value={appConfig}>
      <SpeechServiceContext.Provider value={{ speechService: mockService, isSpeaking, currentSpeechText }}>
        <SpeakingIndicator />
      </SpeechServiceContext.Provider>
    </AppConfigContext.Provider>
  );

  return { speechService: mockService };
};

describe("SpeakingIndicator", () => {
  it("does not render when readAloudEnabled is false", () => {
    renderSpeakingIndicator({ readAloudEnabled: false, isSpeaking: true, currentSpeechText: "Hello" });
    expect(screen.queryByTestId("speaking-indicator")).not.toBeInTheDocument();
  });

  it("does not render when not speaking", () => {
    renderSpeakingIndicator({ readAloudEnabled: true, isSpeaking: false });
    expect(screen.queryByTestId("speaking-indicator")).not.toBeInTheDocument();
  });

  it("renders when readAloudEnabled is true and speaking", () => {
    renderSpeakingIndicator({ readAloudEnabled: true, isSpeaking: true, currentSpeechText: "Hello" });
    expect(screen.getByTestId("speaking-indicator")).toBeInTheDocument();
    expect(screen.getByText("Speaking...")).toBeInTheDocument();
  });

  it("does not render when current speech text is a processing message", () => {
    renderSpeakingIndicator({ readAloudEnabled: true, isSpeaking: true, currentSpeechText: "Processing your request" });
    expect(screen.queryByTestId("speaking-indicator")).not.toBeInTheDocument();
  });

  it("has accessible role status", () => {
    renderSpeakingIndicator({ readAloudEnabled: true, isSpeaking: true, currentSpeechText: "Hello" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("stop button has accessible label and calls stopSpeech", () => {
    const { speechService } = renderSpeakingIndicator({
      readAloudEnabled: true, isSpeaking: true, currentSpeechText: "Hello"
    });

    const stopButton = screen.getByTestId("stop-speech-button");
    expect(stopButton).toHaveAttribute("aria-label", "Stop speech");

    fireEvent.click(stopButton);
    expect(speechService.stopSpeech).toHaveBeenCalled();
  });
});
