import React, { FormEvent, useEffect, useRef, useState } from "react";

import { isInputElement } from "../utils";

import "./chat-input.scss";

interface IProps {
  onKeyboardShortcut: () => void;
  onSubmit: (messageText: string) => void;
}

export const ChatInputComponent = ({onKeyboardShortcut, onSubmit}: IProps) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  // const [browserSupportsDictation, setBrowserSupportsDictation] = useState(false);
  // const [dictationEnabled, setDictationEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [showError, setShowError] = useState(false);

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    // setDictationEnabled(false);

    if (!inputValue || inputValue.trim() === "") {
      setShowError(true);
      textAreaRef.current?.focus();
    } else {
      onSubmit(inputValue);
      setInputValue("");
      setShowPlaceholder(false);
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

  // The code in this useEffect is all related to the dictation feature which isn't implemented yet.
  // useEffect(() => {
  //   if (!window.SpeechRecognition && !window.webkitSpeechRecognition) return;

  //   const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  //   if (SpeechRecognition) {
  //     setBrowserSupportsDictation(true);
  //   }

  //   const recognition = new SpeechRecognition();
  //   recognition.continuous = true;
  //   recognition.interimResults = false;

  //   recognition.onresult = (event: SpeechRecognitionEvent) => {
  //     const speechToText = Array.from(event.results).map(result => result[0].transcript).join("");
  //     setInputValue(speechToText);
  //   };

  //   recognition.onerror = (event) => {
  //     console.error("Speech recognition error detected:", event.error);
  //   };

  //   recognition.onaudiostart = () => {
  //     // We may want the UI respond somehow when audio capture begins.
  //     console.log("Microphone capturing audio.");
  //   };

  //   if (dictationEnabled) {
  //     try {
  //       recognition.start();
  //     } catch (error) {
  //       console.error("Error starting recognition:", error);
  //     }
  //   } else {
  //     recognition.stop();
  //   }

  //   return () => recognition.stop();
  // }, [browserSupportsDictation, dictationEnabled]);

  // const handleDictateToggle = () => {
  //   if (dictationEnabled) {
  //     handleSubmit();
  //   }
  //   setDictationEnabled(!dictationEnabled);
  // };

  useEffect(() => {
    // Add a keyboard shortcut for placing focus on the chat input when the user's focus is outside the iframe.

    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    // const keys = {
    //   d: false,
    //   a: false
    // };
  
    if (window.parent !== window) {
      window.parent.document.addEventListener("keydown", (event) => {
        // if (event.key === "d") keys.d = true;
        // if (event.key === "a") keys.a = true;

        if ((isMac && event.metaKey && event.ctrlKey && event.key === "a") || // Command + Option + D on macOS
            (!isMac && event.ctrlKey && event.altKey && event.key === "a")) {// Ctrl + Alt + D on Windows/Linux
          //if (keys.d && keys.a) {

            // Check if the focused element is an input, textarea, or content-editable
            const activeElement = window.parent.document.activeElement;
            if (isInputElement(activeElement)) {
              // keys.d = false;
              // keys.a = false;
              return;
            }

            const iframe = window.frameElement;
            if (iframe) {
              if (textAreaRef.current) {
                textAreaRef.current.focus();
                onKeyboardShortcut();
                // Reset key states after shortcut is triggered. Note: a complimentary `keyup` listener for
                // handling this won't work reliably in this context.
                // keys.d = false;
                // keys.a = false;
              } else {
                console.warn("Target input not found inside the iframe.");
              }
            }
          //}
        }
      });
    }
  }, [onKeyboardShortcut]);

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
            id="chat-input"
            placeholder={showPlaceholder ? "Ask DAVAI about the data" : ""}
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyUp={handleKeyUp}
          />
          {showError &&
            <div
              aria-live="assertive"
              className="error"
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
              type="submit"
            >
              Send
            </button>
            {/* {browserSupportsDictation && 
              <button
                aria-pressed={dictationEnabled}
                className="dictate"
                type="button"
                onClick={handleDictateToggle}
              >
                Dictate
              </button>
            } */}
          </div>
        </fieldset>
      </form>
    </div>
  );
};
