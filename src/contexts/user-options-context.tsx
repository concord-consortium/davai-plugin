import React, { createContext, useContext, useEffect, useState } from "react";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { getUrlParam } from "../utils/utils";
import { IUserOptions } from "../types";

const kDefaultOptions = {
  keyboardShortcutEnabled: true,
  keyboardShortcutKeys: "",
  playProcessingMessage: true,
  playProcessingTone: false,
  playbackSpeed: 1,
  readAloudEnabled: false,
  showDebugLog: false,
};

interface IOptionsContext {
  options: IUserOptions;
  setOptions: React.Dispatch<React.SetStateAction<IUserOptions>>;
}

export const UserOptionsContext = createContext<IOptionsContext>({
  options: kDefaultOptions,
  setOptions: () => undefined,
});

export const UserOptionsProvider = ({ children }: {children: React.ReactNode}) => {
  const appConfig = useAppConfigContext();
  const [options, setOptions] = useState(kDefaultOptions);

  useEffect(() => {
    const isShortcutEnabled = JSON.parse(localStorage.getItem("keyboardShortcutEnabled") || "true");
    const shortcutKeys = localStorage.getItem("keyboardShortcutKeys") || appConfig.accessibility.keyboardShortcut;
    const isDevMode = getUrlParam("mode") === "development" || appConfig.mode === "development";
    const initialOptions = {
      ...kDefaultOptions,
      keyboardShortcutEnabled: isShortcutEnabled,
      keyboardShortcutKeys: shortcutKeys,
      showDebugLog: isDevMode,
    };
    setOptions(initialOptions);
  }, [appConfig.mode, appConfig.accessibility.keyboardShortcut]);

  return (
    <UserOptionsContext.Provider value={{options, setOptions}}>
      {children}
    </UserOptionsContext.Provider>
  );
};

export const useOptions = () => {
  const { options, setOptions } = useContext(UserOptionsContext);
  const {keyboardShortcutEnabled, keyboardShortcutKeys, playbackSpeed, playProcessingTone, playProcessingMessage,
    readAloudEnabled, showDebugLog} = options;

  const updateOptions = (newOptions: Partial<IUserOptions>) => {
    setOptions((prevOptions) => ({
      ...prevOptions,
      ...newOptions,
    }));
  };

  const toggleOption = (option: keyof IUserOptions) => {
    setOptions((prevOptions) => ({
      ...prevOptions,
      [option]: !prevOptions[option],
    }));
  };

  return {
    keyboardShortcutEnabled,
    keyboardShortcutKeys,
    playbackSpeed,
    playProcessingMessage,
    playProcessingTone,
    readAloudEnabled,
    showDebugLog,
    options,
    updateOptions,
    toggleOption
  };
};

