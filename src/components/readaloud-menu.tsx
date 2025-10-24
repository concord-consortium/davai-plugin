import React from "react";
import { observer } from "mobx-react-lite";
import { useAppConfigContext } from "../contexts/app-config-context";
import { AppConfigToggleOptions } from "../models/app-config-model";

interface IProps {
  createToggleOption: (option: AppConfigToggleOptions, optionLabel: string) => React.JSX.Element
}

export const ReadAloudMenu: React.FC<IProps> = observer(function ReadAloudMenu({createToggleOption}) {
  const appConfig = useAppConfigContext();

  const handleSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    appConfig.update(() => {
      appConfig.playbackSpeed = parseFloat(event.target.value);
    });
  };

  return (
    <div className="control-panel-section" role="group" aria-labelledby="readaloud-heading" data-testid="readaloud-menu">
      <h3 id="readaloud-heading">Tap to Read</h3>
      {createToggleOption("readAloudEnabled", `Enable "Tap to Read" mode`)}
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
          defaultValue={appConfig.playbackSpeed}
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
});
