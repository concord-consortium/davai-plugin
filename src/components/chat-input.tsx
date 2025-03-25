import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptions } from "../hooks/use-options";
import { kDefaultChatInputHeight, START_RECORDING_NOTE, STOP_RECORDING_NOTE } from "../constants";
import { playSound, isInputElement, isShortcutPressed } from "../utils/utils";

import "./chat-input.scss";

interface IProps {
  disabled?: boolean;
  onKeyboardShortcut: () => void;
  onSubmit: (messageText: string) => void;
}

export const ChatInputComponent = ({disabled, onKeyboardShortcut, onSubmit}: IProps) => {
  const { keyboardShortcutEnabled, keyboardShortcutKeys } = useOptions();
  const [browserSupportsDictation, setBrowserSupportsDictation] = useState(false);
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showError, setShowError] = useState(false);
  const [textareaHasFocus, setTextareaHasFocus] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const finalSpeechTranscript = useRef<string>("");
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  // We will use this ref in places where asynchronous state updates make directly using the state variable
  // dictationEnabled problematic.
  const dictationEnabledRef = useRef(false);

  const fitTextInputToContent = () => {
    if (textAreaRef.current && containerRef.current) {
      // Temporarily reset the height to recalculate the correct scrollHeight,
      // then set the height as needed to show all text.
      textAreaRef.current.style.height = `${kDefaultChatInputHeight}px`;
      containerRef.current.style.height = `${kDefaultChatInputHeight}px`;
      const newHeight = Math.max(textAreaRef.current.scrollHeight, kDefaultChatInputHeight);
      textAreaRef.current.style.height = `${newHeight}px`;
      containerRef.current.style.height = `${newHeight}px`;
    }
  };

  const handleTextInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
  };

  const handleSubmit = (event?: FormEvent) => {
    if (disabled) return;
    event?.preventDefault();
    event?.stopPropagation();
    setDictationEnabled(false);
    speechRecognitionRef.current?.stop();

    if (!inputValue || inputValue.trim() === "") {
      setShowError(true);
    } else {
      setShowError(false);
      setInputValue("");
      onSubmit(inputValue);
      finalSpeechTranscript.current = "";
    }

    textAreaRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
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
      speechRecognitionRef.current.interimResults = true;

      speechRecognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        // Using the state variable dictationEnabled here can lead to incorrect behavior.
        if (!dictationEnabledRef.current) return;

        const capitalize = (s: string) => {
          const firstChar = /\S/;
          return s.replace(firstChar, function(m) { return m.toUpperCase(); });
        };

        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalSpeechTranscript.current += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        finalSpeechTranscript.current = capitalize(finalSpeechTranscript.current);

        const output = `${finalSpeechTranscript.current} ${interimTranscript}`;
        setInputValue(output);
      };

      speechRecognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error detected:", event.error);
        setDictationEnabled(false);
        playSound(STOP_RECORDING_NOTE);
      };
    }
  }, []);

  useEffect(() => {
    fitTextInputToContent();
  }, [inputValue]);

  useEffect(() => {
    dictationEnabledRef.current = dictationEnabled;
  }, [dictationEnabled]);

  useEffect(() => {
    if (!speechRecognitionRef.current) return;

    if (dictationEnabled) {
      try {
        speechRecognitionRef.current.start();
        // automatically stop after 60 seconds
        timeoutRef.current = setTimeout(() => {
          if (dictationEnabled && speechRecognitionRef.current) {
            setDictationEnabled(false);
            speechRecognitionRef.current.stop();
            playSound(STOP_RECORDING_NOTE);
          }
        }, 60000);
      } catch (error) {
        console.error("Error starting recognition:", error);
      }
    } else {
      speechRecognitionRef.current.stop();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      speechRecognitionRef.current?.stop();
    };
  }, [dictationEnabled]);

  const handleDictateToggle = () => {
    setDictationEnabled(!dictationEnabled);

    if (dictationEnabled) {
      playSound(STOP_RECORDING_NOTE);
    } else {
      playSound(START_RECORDING_NOTE);
    }
  };

  const pressedKeys: Set<string> = useMemo(() => new Set(), []);

  const addShortcutListener = useCallback((context: Window) => {
    const keydownHandler = (event: KeyboardEvent) => {
      pressedKeys.add(event.code);
      if (isShortcutPressed(pressedKeys, keyboardShortcutKeys)) {
        event.preventDefault();
        const activeElement = context.document.activeElement;
        if (isInputElement(activeElement)) return;

        onKeyboardShortcut();
        textAreaRef.current?.focus();
        textAreaRef.current?.scrollIntoView({behavior: "smooth", block: "nearest"});
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
  }, [onKeyboardShortcut, pressedKeys, keyboardShortcutKeys]);

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

  const handleBlur = () => {
    setTextareaHasFocus(false);
    textAreaRef.current?.blur();
  };

  const handleFocus = () => {
    setTextareaHasFocus(true);
    textAreaRef.current?.focus();
  };

  return (
    <div className={`chat-input ${textareaHasFocus ? "has-focus" : ""}`} ref={containerRef} data-testid="chat-input">
      <label className="visually-hidden" data-testid="chat-input-label" htmlFor="chat-input">
        Chat Input
      </label>
      <div className="textarea-container">
        <textarea
          aria-describedby={showError ? "input-error" : undefined}
          aria-invalid={showError}
          data-testid="chat-input-textarea"
          id="chat-input"
          placeholder={"Ask DAVAI about the data"}
          ref={textAreaRef}
          value={inputValue}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onChange={handleTextInputChange}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="buttons-container">
        {browserSupportsDictation &&
          <button
            className={dictationEnabled ? "dictate active" : "dictate"}
            data-testid="chat-input-dictate"
            type="button"
            onClick={handleDictateToggle}
          >
            {dictationEnabled ? "Stop Dictation" : "Start Dictation"}
          </button>
        }
        <button
          className="send"
          data-testid="chat-input-send"
          aria-disabled={disabled}
          onClick={handleSubmit}
        >
          Send
        </button>
      </div>
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
    </div>
  );
};
