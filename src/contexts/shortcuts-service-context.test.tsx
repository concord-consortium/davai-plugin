import { when } from "mobx";
import { createKeybindingsHandler } from "../utils/tinykeys";
import { AppConfigModel, AppConfigModelType } from "../models/app-config-model";
import { ShortcutsService } from "./shortcuts-service-context";
import appConfigJSON from "../app-config.json";
import { create } from "domain";

// Mock the tinykeys utility
jest.mock("../utils/tinykeys", () => ({
  createKeybindingsHandler: jest.fn((...args) => {
    // Return a mock handler function
    const handler = jest.fn();
    // Store the args so we can inspect them in tests
    (handler as any).tinykeysArgs = args;
    return handler;
  }),
}));

describe("ShortcutsService", () => {
  let appConfig: AppConfigModelType;
  let shortcutsService: ShortcutsService;
  let mockHandler: jest.Mock;

  beforeEach(() => {
    appConfig = AppConfigModel.create(appConfigJSON);
    shortcutsService = new ShortcutsService(appConfig);
    mockHandler = jest.fn();
    jest.spyOn(window, "addEventListener");
    jest.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    shortcutsService.dispose();
    jest.clearAllMocks();
  });

  /**
   * Waits for the the autorun to initialize the main handler
   */
  async function waitForMainHandlerInit() {
    await when(() => shortcutsService.mainHandler !== undefined, { timeout: 200 });
    expect(shortcutsService.mainHandler).toBeDefined();
  }

  it("should register a shortcut handler", async () => {
    const unregister = shortcutsService.registerShortcutHandler("playGraphSonification", mockHandler);
    expect(shortcutsService.shortcutHandlers.has("playGraphSonification")).toBe(true);

    await waitForMainHandlerInit();
    expect(createKeybindingsHandler).toHaveBeenCalledWith({
      [appConfig.keyboardShortcuts.playGraphSonification]: expect.any(Function)
    });

    unregister();
  });

  it("should remove a shortcut handler, and remove the main handler if no more shortcuts are registered", async () => {
    const unregister = shortcutsService.registerShortcutHandler("playGraphSonification", mockHandler);
    expect(shortcutsService.shortcutHandlers.size).toBe(1);

    await waitForMainHandlerInit();

    unregister();
    expect(shortcutsService.shortcutHandlers.size).toBe(0);

    // Wait for the autorun to remove the main handler
    await when(() => shortcutsService.mainHandler === undefined, { timeout: 200 });
    expect(shortcutsService.mainHandler).toBeUndefined();
  });

  it("should dispose the service", () => {
    shortcutsService.registerShortcutHandler("playGraphSonification", mockHandler);

    shortcutsService.dispose();

    expect(shortcutsService.mainHandler).toBeUndefined();
    expect(shortcutsService.shortcutHandlers.size).toBe(0);
  });

  it("should focus the iframe when the shortcut is triggered and the focus option is set", async () => {
    const focusFunc = jest.fn();
    shortcutsService.setFocusOurIFrameFunc(focusFunc);
    shortcutsService.registerShortcutHandler("playGraphSonification", mockHandler, { focus: true });

    await waitForMainHandlerInit();

    // Simulate the keydown event
    const event = {} as KeyboardEvent;
    const tinykeysMap = shortcutsService.tinykeysShortcutMap;
    tinykeysMap[appConfig.keyboardShortcuts.playGraphSonification](event);

    expect(focusFunc).toHaveBeenCalled();
    expect(mockHandler).toHaveBeenCalledWith(event);
  });
});
