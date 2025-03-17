import React from "react";
import { DAVAI_SPEAKER } from "../constants";
import { timeStamp } from "../utils/utils";

interface IProps {
  cancelStatus?: string;
}

export const LoadingMessage: React.FC<IProps> = ({cancelStatus}) => {
  return (
    <div
      aria-label={`${DAVAI_SPEAKER} at ${timeStamp()}`}
      className={`chat-transcript__message ${DAVAI_SPEAKER.toLowerCase()}`}
      data-testid="chat-message"
      role="listitem"
    >
      <h3 data-testid="chat-message-speaker">
        {DAVAI_SPEAKER}
      </h3>
      <div
        className={`chat-message-content ${DAVAI_SPEAKER.toLowerCase()}`}
        data-testid="chat-message-content"
      >
        { cancelStatus ?
          <div className="cancelling">
            {cancelStatus}
            <div className="loading"/>
          </div> :
          <div
            aria-label="Loading response, please wait"
            className="loading"
            data-testid="loading" role="status" aria-live="polite"
          >
          </div>
        }
      </div>
    </div>
  );
};
