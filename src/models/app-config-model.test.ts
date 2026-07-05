import { AppConfigModel, AppConfigModelSnapshot } from "./app-config-model";
import appConfigJson from "../app-config.json";
import { mockAppConfig } from "../test-utils/mock-app-config";

describe("AppConfigModel keyboard shortcuts", () => {
  it("includes the captureTranscript shortcut from app-config.json", () => {
    const appConfig = AppConfigModel.create(appConfigJson as AppConfigModelSnapshot);
    expect(appConfig.keyboardShortcuts.captureTranscript).toBe("Control+Shift+Semicolon");
  });
});

describe("AppConfigModel streamResponses", () => {
  it("defaults streamResponses to true", () => {
    const config = AppConfigModel.create(mockAppConfig);
    expect(config.streamResponses).toBe(true);
  });

  it("has an effort setting that defaults to empty and is settable", () => {
    const config = AppConfigModel.create(mockAppConfig as AppConfigModelSnapshot);
    expect(config.effort).toBe("");
    config.setEffort("low");
    expect(config.effort).toBe("low");
  });
});

describe("AppConfigModel isLocalLlm", () => {
  it("isLocalLlm is true only for the Local provider", () => {
    const local = AppConfigModel.create({
      ...mockAppConfig,
      llmId: JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }),
    });
    expect(local.isLocalLlm).toBe(true);

    const server = AppConfigModel.create({
      ...mockAppConfig,
      llmId: JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }),
    });
    expect(server.isLocalLlm).toBe(false);
  });
});
