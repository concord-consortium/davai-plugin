import { AppConfigModel, AppConfigModelSnapshot } from "./app-config-model";
import appConfigJson from "../app-config.json";

describe("AppConfigModel keyboard shortcuts", () => {
  it("includes the captureTranscript shortcut from app-config.json", () => {
    const appConfig = AppConfigModel.create(appConfigJson as AppConfigModelSnapshot);
    expect(appConfig.keyboardShortcuts.captureTranscript).toBe("Control+Shift+Semicolon");
  });
});
