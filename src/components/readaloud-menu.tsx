import React from "react";
import { observer } from "mobx-react-lite";
import { useAppConfigContext } from "../contexts/app-config-context";
import { AppConfigToggleOptions } from "../models/app-config-model";

interface IProps {
  createToggleOption: (option: AppConfigToggleOptions, optionLabel: string, describedBy?: string) => React.JSX.Element
}

export const ReadAloudMenu: React.FC<IProps> = observer(function ReadAloudMenu({createToggleOption}) {
  const appConfig = useAppConfigContext();
  const readAloudHelperTextId = "read-aloud-helper-text";

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    appConfig.update(() => {
      appConfig.playbackSpeed = parseFloat(event.target.value);
    });
  };

  return (
    <div className="control-panel-section" role="group" aria-labelledby="readaloud-heading" data-testid="readaloud-menu">
      <h3 id="readaloud-heading">Read Responses Aloud</h3>
      <div className="options-list-1">
        {createToggleOption("readAloudEnabled", "Read responses aloud", readAloudHelperTextId)}
        <div className="user-option">
          <label
            data-testid="speed-label"
            htmlFor="readaloud-playback-speed"
          >
            Playback speed:
          </label>
          <select
            onChange={handleSelect}
            data-testid="readaloud-playback-speed"
            defaultValue={appConfig.playbackSpeed}
            id="readaloud-playback-speed"
          >
            <option data-testid="playback-speed-option-1" value={0.5}>0.5x</option>
            <option data-testid="playback-speed-option-2" value={0.75}>0.75x</option>
            <option data-testid="playback-speed-option-3" value={1}>1x</option>
            <option data-testid="playback-speed-option-4" value={1.25}>1.25x</option>
            <option data-testid="playback-speed-option-5" value={1.5}>1.5x</option>
            <option data-testid="playback-speed-option-6" value={1.75}>1.75x</option>
            <option data-testid="playback-speed-option-7" value={2}>2x</option>
            <option data-testid="playback-speed-option-8" value={2.25}>2.25x</option>
            <option data-testid="playback-speed-option-9" value={2.5}>2.5x</option>
            <option data-testid="playback-speed-option-10" value={2.75}>2.75x</option>
            <option data-testid="playback-speed-option-11" value={3}>3x</option>
          </select>
        </div>
        <p className="helper-text" id={readAloudHelperTextId} data-testid="readaloud-helper-text">
          Note: If you use a screen reader, you may hear duplicate audio when this feature is enabled.
          Press Escape to stop speech playback at any time.
        </p>
      </div>
    </div>
  );
});
