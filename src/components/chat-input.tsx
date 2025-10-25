import React, { FormEvent, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { kDefaultChatInputHeight, START_RECORDING_NOTE, STOP_RECORDING_NOTE } from "../constants";
import { playSound } from "../utils/utils";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
import { ErrorMessage } from "./error-message";

import StopIcon from "../assets/stop-icon.svg";
import SendIcon from "../assets/send-icon.svg";
import VoiceTypingIcon from "../assets/voice-typing-icon.svg";

import "./chat-input.scss";

interface IProps {
  disabled?: boolean;
  isLoading?: boolean;
  onCancel: () => void;
  onSubmit: (messageText: string) => void;
}

export const ChatInputComponent = observer(function({disabled, isLoading, onCancel, onSubmit}: IProps) {
  const shortcutsService = useShortcutsService();
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

  const handleCancel = () => {
    onCancel();
    textAreaRef.current?.focus();
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

  useEffect(() => {
    return shortcutsService.registerShortcutHandler("focusChatInput", (event) => {
      event.preventDefault();
      // The old code would ignore the shortcut if an input element was focused.
      // I suspect that was just to work around issues with the key handler, so
      // hopefully it isn't needed anymore.
      // const activeElement = context.document.activeElement;
      // if (isInputElement(activeElement)) return;

      textAreaRef.current?.focus();
      textAreaRef.current?.scrollIntoView({behavior: "smooth", block: "nearest"});
    }, { focus: true });
  }, [shortcutsService]);

  // Place focus on the textarea when the component mounts.
  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  const handleBlur = () => {
    setTextareaHasFocus(false);
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
        {browserSupportsDictation && (
          <button
            aria-pressed={dictationEnabled}
            className={dictationEnabled ? "dictate active" : "dictate"}
            data-testid="chat-input-dictate"
            aria-label={dictationEnabled ? "Stop Dictation" : "Start Dictation"}
            type="button"
            onClick={handleDictateToggle}
          >
            <VoiceTypingIcon />
          </button>
        )}
        {isLoading ? (
          <button
            className="cancel"
            data-testid="chat-input-cancel"
            type="button"
            aria-label="Cancel processing"
            onClick={handleCancel}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            className="send"
            data-testid="chat-input-send"
            aria-disabled={disabled || !inputValue}
            aria-label="Send message"
            onClick={handleSubmit}
          >
            <SendIcon />
          </button>
        )}
      </div>
      {showError && <ErrorMessage slug="input" message="Please enter a message before sending." />}
    </div>
  );
});
