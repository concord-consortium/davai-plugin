import React, { FormEvent, useRef, useState } from "react";

import "./chat-input.scss";

interface IProps {
  onSubmit: (messageText: string) => void;
}

export const ChatInputComponent = ({onSubmit}: IProps) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  // const [browserSupportsDictation, setBrowserSupportsDictation] = useState(false);
  // const [dictationEnabled, setDictationEnabled] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [showPlaceholder, setShowPlaceholder] = useState(true);

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    // setDictationEnabled(false);
    onSubmit(inputValue);
    setInputValue("");
    setShowPlaceholder(false);
    textAreaRef.current?.focus();
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

  return (
    <div className="chat-input" data-testid="chat-input">
      <form onSubmit={handleSubmit}>
        <fieldset>
          <label className="visually-hidden" data-testid="chat-input-label" htmlFor="chat-input">
            Chat Input
          </label>
          <textarea
            data-testid="chat-input-textarea"
            id="chat-input"
            placeholder={showPlaceholder ? "Ask DAVAI about the data" : ""}
            ref={textAreaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyUp={handleKeyUp}
          />
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
