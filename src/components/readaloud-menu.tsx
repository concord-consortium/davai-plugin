import React from "react";

import "./readaloud-menu.scss";

interface IReadAloudMenuProps {
  enabled: boolean;
  onToggle: () => void;
  playbackSpeed: number;
  onPlaybackSpeedSelect: (speed: number) => void;
}

export const ReadAloudMenu = (props: IReadAloudMenuProps) => {
  const { enabled, onToggle, playbackSpeed, onPlaybackSpeedSelect } = props;

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onPlaybackSpeedSelect(parseFloat(event.target.value));
  };

  return (
    <div className="readaloud-controls">
      <div className="toggle">
        <label htmlFor="readaloud-toggle" data-testid="toggle-label">
          Tap text to listen
        </label>
        <input
          data-testid="readaloud-toggle"
          id="readaloud-toggle"
          type="checkbox"
          role="switch"
          checked={enabled}
          aria-checked={enabled}
          onChange={onToggle}
        />
      </div>
      <div className="select-playback-speed">
        <label
          data-testid="speed-label"
          className="visually-hidden"
          htmlFor="readaloud-playback-speed"
        >
          Select playback speed
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
