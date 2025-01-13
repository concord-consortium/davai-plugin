import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { alertSound, isInputElement, isShortcutPressed } from "../utils/utils";

import "./chat-input.scss";

interface IProps {
  disabled?: boolean;
  keyboardShortcutEnabled: boolean;
  shortcutKeys: string;
  onKeyboardShortcut: () => void;
  onSubmit: (messageText: string) => void;
}

export const ChatInputComponent = ({disabled, keyboardShortcutEnabled, shortcutKeys, onKeyboardShortcut, onSubmit}: IProps) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showError, setShowError] = useState(false);
  const [browserSupportsDictation, setBrowserSupportsDictation] = useState(false);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    setDictationEnabled(false);

    if (!inputValue || inputValue.trim() === "") {
      setShowError(true);
      textAreaRef.current?.focus();
    } else {
      onSubmit(inputValue);
      setInputValue("");
      textAreaRef.current?.focus();
      setShowError(false);
    }
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      textAreaRef.current?.blur();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setBrowserSupportsDictation(true);

    if (!speechRecognitionRef.current) {
      speechRecognitionRef.current = new SpeechRecognition();
      speechRecognitionRef.current.continuous = true;
      speechRecognitionRef.current.interimResults = false;

      speechRecognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        const latestResult = event.results[event.results.length - 1];
        const speechToText = latestResult[0].transcript;
        setInputValue(prevValue => (`${prevValue} ${speechToText}`).trim());
      };

      speechRecognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error detected:", event.error);
        setDictationEnabled(false);
        alertSound("stop");
      };
    }
  }, []);

  useEffect(() => {
    if (!speechRecognitionRef.current) return;

    if (dictationEnabled) {
      try {
        speechRecognitionRef.current.start();
        // automatically stop after 60 seconds
        setTimeout(() => {
          speechRecognitionRef.current?.stop();
        }, 60000);
      } catch (error) {
        console.error("Error starting recognition:", error);
      }
    } else {
      speechRecognitionRef.current.stop();
    }

    return () => speechRecognitionRef.current?.stop();
  }, [dictationEnabled]);

  const handleDictateToggle = () => {
    setDictationEnabled(!dictationEnabled);

    if (dictationEnabled) {
      alertSound("stop");
    } else {
      alertSound("start");
    }
  };

  const pressedKeys: Set<string> = useMemo(() => new Set(), []);

  const addShortcutListener = useCallback((context: Window) => {
    const keydownHandler = (event: KeyboardEvent) => {
      pressedKeys.add(event.code);
      if (isShortcutPressed(pressedKeys, shortcutKeys)) {
        event.preventDefault();
        const activeElement = context.document.activeElement;
        if (isInputElement(activeElement)) return;

        if (window.frameElement) {
          textAreaRef.current?.focus();
          onKeyboardShortcut();
        } else {
          textAreaRef.current?.focus();
          onKeyboardShortcut();
        }
      }
    };

    const keyupHandler = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code);
    };

    context.document.addEventListener("keydown", keydownHandler);
    context.document.addEventListener("keyup", keyupHandler);

    // Return handler for cleanup
    return () => {
      context.document.removeEventListener("keydown", keydownHandler);
      context.document.removeEventListener("keyup", keyupHandler);
    };
  }, [onKeyboardShortcut, pressedKeys, shortcutKeys]);

  useEffect(() => {
    const keydownListeners: (() => void)[] = [];

    if (keyboardShortcutEnabled) {
      // Add keyboard shortcut listener to the parent window if one exists.
      if (window.parent && window.parent !== window) {
        keydownListeners.push(addShortcutListener(window.parent));
      }

      // Add keyboard shortcut listener to the current window.
      keydownListeners.push(addShortcutListener(window));
    }

    return () => {
      keydownListeners.forEach((cleanup) => cleanup());
    };
  }, [addShortcutListener, keyboardShortcutEnabled]);

  // Place focus on the textarea when the component mounts.
  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  return (
    <div className="chat-input" data-testid="chat-input">
      <form onSubmit={handleSubmit}>
        <fieldset>
          <label className="visually-hidden" data-testid="chat-input-label" htmlFor="chat-input">
            Chat Input
          </label>
          <textarea
            aria-describedby={showError ? "input-error" : undefined}
            aria-invalid={showError}
            data-testid="chat-input-textarea"
            disabled={disabled}
            id="chat-input"
            placeholder={"Ask DAVAI about the data"}
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyUp={handleKeyUp}
          />
          {showError &&
            <div
              aria-live="assertive"
              className="error-message"
              data-testid="input-error"
              id="input-error"
              role="alert"
            >
              Please enter a message before sending.
            </div>
          }
          <div className="buttons-container">
            <button
              className="send"
              data-testid="chat-input-send"
              disabled={disabled}
              type="submit"
            >
              Send
            </button>
            {browserSupportsDictation && 
              <button
                aria-label={dictationEnabled ? "Stop Dictation" : "Start Dictation"}
                aria-pressed={dictationEnabled}
                className={dictationEnabled ? "dictate active" : "dictate"}
                data-testid="chat-input-dictate"
                disabled={disabled}
                type="button"
                onClick={handleDictateToggle}
              >
                {dictationEnabled ? "Listening..." : "Dictate"}
              </button>
            }
          </div>
        </fieldset>
      </form>
    </div>
  );
};
