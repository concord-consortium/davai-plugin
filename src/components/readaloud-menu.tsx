import React from "react";
import { useOptions } from "../contexts/user-options-context";

export const ReadAloudMenu = () => {
  const { readAloudEnabled, playbackSpeed, toggleOption, updateOptions } = useOptions();

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateOptions({playbackSpeed: parseFloat(event.target.value)});
  };

  return (
    <div className="options-section">
      <div className="options-section-header">
        <h3>Tap to Read</h3>
      </div>
      <div className="user-option">
        <label htmlFor="readaloud-toggle" data-testid="toggle-label">
          {`Enable "Tap to Read" mode:`}
        </label>
        <input
          data-testid="readaloud-toggle"
          id="readaloud-toggle"
          type="checkbox"
          role="switch"
          checked={readAloudEnabled}
          aria-checked={readAloudEnabled}
          onChange={() => toggleOption("readAloudEnabled")}
        />
      </div>
      <div className="user-option">
        <label
          data-testid="speed-label"
          htmlFor="readaloud-playback-speed"
        >
          {`"Tap to Read" playback speed:`}
        </label>
        <select
          onChange={handleSelect}
          data-testid="readaloud-playback-speed"
          defaultValue={playbackSpeed}
          id="readaloud-playback-speed"
        >
          <option data-testid="playback-speed-option-1" value={0.5}>.5x</option>
          <option data-testid="playback-speed-option-2" value={1}>1x</option>
          <option data-testid="playback-speed-option-3" value={1.5}>1.5x</option>
          <option data-testid="playback-speed-option-4" value={2}>2x</option>
        </select>
      </div>
    </div>
  );
};
