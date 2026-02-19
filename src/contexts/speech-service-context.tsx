import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { SpeechService, ISpeechService } from "../services/speech-service";
import { useAppConfigContext } from "./app-config-context";
import { useAriaLive } from "./aria-live-context";

interface SpeechServiceContextValue {
  speechService: ISpeechService;
  isSpeaking: boolean;
  currentSpeechText: string | null;
}

export const SpeechServiceContext = createContext<SpeechServiceContextValue | null>(null);

export const SpeechServiceProvider = ({ children }: { children: React.ReactNode }) => {
  const appConfig = useAppConfigContext();
  const { ariaLiveText, setAriaLiveText } = useAriaLive();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentSpeechText, setCurrentSpeechText] = useState<string | null>(null);

  // Use useState with lazy initialization to create the service once
  const [speechService] = useState(() => new SpeechService(
    () => appConfig.readAloudEnabled,
    () => appConfig.playbackSpeed,
    (error: string) => {
      // Announce errors via aria-live for screen reader users
      setAriaLiveText(error);
    }
  ));

  // Subscribe to speaking state changes
  useEffect(() => {
    const unsubscribe = speechService.onSpeakingChange(setIsSpeaking);
    return unsubscribe;
  }, [speechService]);

  // Track previous ariaLiveText to detect changes
  const prevAriaLiveTextRef = useRef<string | undefined>(undefined);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Speak whenever ariaLiveText changes (but not on initial mount)
  // Use debouncing to avoid rapid cancellations when text changes quickly
  useEffect(() => {
    if (ariaLiveText && ariaLiveText !== prevAriaLiveTextRef.current) {
      // Clear any pending debounce
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      // Debounce speech to avoid rapid cancellations
      debounceTimeoutRef.current = setTimeout(() => {
        setCurrentSpeechText(ariaLiveText);
        speechService.speak(ariaLiveText);
        debounceTimeoutRef.current = null;
      }, 100);
    }
    prevAriaLiveTextRef.current = ariaLiveText;

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [ariaLiveText, speechService]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      speechService.dispose();
    };
  }, [speechService]);

  const contextValue: SpeechServiceContextValue = {
    speechService,
    isSpeaking,
    currentSpeechText,
  };

  return (
    <SpeechServiceContext.Provider value={contextValue}>
      {children}
    </SpeechServiceContext.Provider>
  );
};

export const useSpeechService = (): ISpeechService => {
  const context = useContext(SpeechServiceContext);
  if (!context) {
    throw new Error("useSpeechService must be used within a SpeechServiceProvider");
  }
  return context.speechService;
};

export const useIsSpeaking = (): boolean => {
  const context = useContext(SpeechServiceContext);
  if (!context) {
    throw new Error("useIsSpeaking must be used within a SpeechServiceProvider");
  }
  return context.isSpeaking;
};

export const useCurrentSpeechText = (): string | null => {
  const context = useContext(SpeechServiceContext);
  if (!context) {
    throw new Error("useCurrentSpeechText must be used within a SpeechServiceProvider");
  }
  return context.currentSpeechText;
};
