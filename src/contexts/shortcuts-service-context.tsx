import React, { createContext, useContext, useEffect } from "react";
import { createKeybindingsHandler } from "../utils/tinykeys";
import { AppConfigKeyboardShortcutKeys, AppConfigModelType } from "../models/app-config-model";
import { action, autorun, computed, makeObservable, observable } from "mobx";
import { useAppConfigContext } from "./app-config-context";

export interface ShortcutHandlerOptions {
  /**
   * If true, when the shortcut is triggered, and the parent window supports it,
   * the iframe containing the app will be focused first.
   */
  focus?: boolean;
}

interface ShortcutHandler {
  options?: ShortcutHandlerOptions;
  handlerFunc: (event: KeyboardEvent) => void;
}

class ShortcutsService {
  shortcutHandlers: Map<AppConfigKeyboardShortcutKeys, ShortcutHandler> = new Map();
  private mainHandler: EventListener | undefined;
  private autorunDisposer: () => void;

  // When running in an iframe, if the parent window supports it, it can set a function
  // that will tell the parent to focus our iframe.
  private focusOurIFrameFunc: (() => void) | undefined;

  constructor(private appConfig: AppConfigModelType) {
    makeObservable(this, {
      shortcutHandlers: observable,
      tinykeysShortcutMap: computed,
      registerShortcutHandler: action
    });
    // Automatically update the main handler when keyboard shortcut is enabled/disabled
    // It should also run when a shortcut string is changed in the app config
    // Or when a shortcut handler is added/removed
    this.autorunDisposer = autorun(() => {
      if (!appConfig.keyboardShortcutsEnabled) {
        this.removeMainHandler();
      } else {
        this.updateMainHandler();
      }
    });
  }

  setFocusOurIFrameFunc(focusOurIFrameFunc: () => void) {
    this.focusOurIFrameFunc = focusOurIFrameFunc;
  }

  registerShortcutHandler(shortcut: AppConfigKeyboardShortcutKeys, handlerFunc: (event: KeyboardEvent) => void, options?: ShortcutHandlerOptions) {
    if (this.shortcutHandlers.has(shortcut)) {
      console.warn(`Shortcut ${shortcut} is already registered, overwriting.`);
    }

    // Add the shortcut and handler to the map
    this.shortcutHandlers.set(shortcut, {handlerFunc, options});

    return () => {
      // We use the handler function to remove the shortcut instead of the shortcut key
      // This way if the shortcut has been overridden by another component we don't remove
      // the other component's handler
      this.removeShortcutHandler(handlerFunc);
    };
  }

  removeMainHandler() {
    if (this.mainHandler) {
      window.removeEventListener("keydown", this.mainHandler);
      if (window.parent && window.parent !== window) {
        window.parent.removeEventListener("keydown", this.mainHandler);
      }
      this.mainHandler = undefined;
    }
  }

  get tinykeysShortcutMap() {
    const shortcutMap: Record<string, (event: KeyboardEvent) => void> = {};
    for (const [shortcut, handler] of this.shortcutHandlers.entries()) {
      const appConfigShortcut = this.appConfig.keyboardShortcuts[shortcut];
      if (!appConfigShortcut) continue;

      shortcutMap[appConfigShortcut] = (event: KeyboardEvent) => {
        if (handler.options?.focus && this.focusOurIFrameFunc) {
          this.focusOurIFrameFunc();
        }
        handler.handlerFunc(event);
      };
    }
    return shortcutMap;
  }

  updateMainHandler() {
    if (Object.keys(this.shortcutHandlers).length > 0) {
      const newHandler = createKeybindingsHandler(this.tinykeysShortcutMap);

      this.removeMainHandler();
      this.mainHandler = newHandler;

      window.addEventListener("keydown", this.mainHandler);
      if (window.parent && window.parent !== window) {
        window.parent.addEventListener("keydown", this.mainHandler);
      }
    } else {
      this.removeMainHandler();
    }
  }

  removeShortcutHandler(handlerFunc: (event: KeyboardEvent) => void) {
    // Remove the shortcut and handler from the map
    // Find the shortcut key for the given handler
    let shortcut: AppConfigKeyboardShortcutKeys | undefined;
    for (const [key, value] of this.shortcutHandlers) {
      if (value.handlerFunc === handlerFunc) {
        shortcut = key;
        break;
      }
    }

    if (!shortcut) return;
    this.shortcutHandlers.delete(shortcut);
  }

  dispose() {
    this.autorunDisposer();
    this.removeMainHandler();
    this.shortcutHandlers.clear();
  }
}

export const ShortcutsServiceContext = createContext<ShortcutsService | null>(null);

export const ShortcutsServiceProvider = ({ children }: { children: React.ReactNode; }) => {
  const appConfig = useAppConfigContext();
  const shortcutsService = new ShortcutsService(appConfig);
  return (
    <ShortcutsServiceContext.Provider value={shortcutsService}>
      {children}
    </ShortcutsServiceContext.Provider>
  );
};

export const useShortcutsService = (): ShortcutsService => {
  const shortcutsService = useContext(ShortcutsServiceContext);
  useEffect(() => {
    return () => {
      shortcutsService?.dispose();
    };
  }, [shortcutsService]);
  if (!shortcutsService) {
    throw new Error("useShortcutsService must be used within a ShortcutsServiceProvider");
  }
  return shortcutsService;
};
