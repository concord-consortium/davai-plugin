import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAppConfigContext } from "./app-config-context";
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

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    options,
    setOptions,
  }), [options]);

  return (
    <UserOptionsContext.Provider value={value}>
      {children}
    </UserOptionsContext.Provider>
  );
};

export const useOptions = () => {
  const { options, setOptions } = useContext(UserOptionsContext);

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
    options,
    updateOptions,
    toggleOption
  };
};
