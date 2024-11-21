import React, { forwardRef } from "react";

import "./readaloud-menu.scss";

interface IReadAloudMenuProps {
  enabled: boolean;
  onToggle: () => void;
  playbackSpeed: number;
  onPlaybackSpeedSelect: (speed: number) => void;
}

export const ReadAloudMenu = forwardRef<HTMLDivElement, IReadAloudMenuProps>((props, ref) => {
  const { enabled, onToggle, playbackSpeed, onPlaybackSpeedSelect } = props;

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onPlaybackSpeedSelect(parseFloat(event.target.value));
  };

  return (
    <div ref={ref} className="readaloud-controls" role="menu">
      <div role="menuitem" className="toggle">
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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
        />
      </div>
      <div role="menuitem">
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
          value={playbackSpeed}
          id="readaloud-playback-speed"
        >
          <option value="0.5" data-testid="playback-speed-option-1">0.5x</option>
          <option value="1" data-testid="playback-speed-option-2">1x</option>
          <option value="1.5" data-testid="playback-speed-option-3">1.5x</option>
          <option value="2" data-testid="playback-speed-option-4">2x</option>
        </select>
      </div>
    </div>
  );
});

ReadAloudMenu.displayName = "ReadAloudMenu";
