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
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const kDefaultHeight = 47;
  const [textareaHasFocus, setTextareaHasFocus] = useState(false);
  const [showError, setShowError] = useState(false);
  const [browserSupportsDictation, setBrowserSupportsDictation] = useState(false);
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
      textAreaRef.current.style.height = `${kDefaultHeight}px`;
      containerRef.current.style.height = `${kDefaultHeight}px`;
      const newHeight = Math.max(textAreaRef.current.scrollHeight, kDefaultHeight);
      textAreaRef.current.style.height = `${newHeight}px`;
      containerRef.current.style.height = `${newHeight}px`;
    }
  };

  const handleTextInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
  };

  const handleSubmit = (event?: FormEvent) => {
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
        alertSound("stop");
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
            alertSound("stop");
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
    console.log("i am mounting");
    textAreaRef.current?.focus();
  }, []);

  useEffect(() => {
    console.log("window.document.activeElement", window.document.activeElement);
  });

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
            aria-pressed={dictationEnabled}
            className={dictationEnabled ? "dictate active" : "dictate"}
            data-testid="chat-input-dictate"
            disabled={disabled}
            title={dictationEnabled ? "Stop Dictation" : "Start Dictation"}
            type="button"
            onClick={handleDictateToggle}
          >
            {dictationEnabled ? "Listening..." : "Dictate"}
          </button>
        }
        <button
          className="send"
          data-testid="chat-input-send"
          disabled={disabled}
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
