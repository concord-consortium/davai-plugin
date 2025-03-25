import { useContext } from "react";
import { UserOptionsContext } from "../contexts/user-options-context";
import { IUserOptions } from "../types";

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
