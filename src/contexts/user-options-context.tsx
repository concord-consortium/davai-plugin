import React, { createContext, useEffect, useState } from "react";
import { useAppConfig } from "../hooks/use-app-config-context";
import { getUrlParam } from "../utils/utils";
import { IUserOptions } from "../types";
import { kDefaultOptions } from "../constants";

interface IOptionsContext {
  options: IUserOptions;
  setOptions: React.Dispatch<React.SetStateAction<IUserOptions>>;
}

export const UserOptionsContext = createContext<IOptionsContext>({
  options: kDefaultOptions,
  setOptions: () => undefined,
});

export const UserOptionsProvider = ({ children }: {children: React.ReactNode}) => {
  const { appConfig } = useAppConfig();
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

