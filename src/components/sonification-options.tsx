import React from "react";
import { observer } from "mobx-react-lite";
import { useAppConfigContext } from "../contexts/app-config-context";
import { DotPlotMode } from "../models/app-config-model";

export const SonificationOptions: React.FC = observer(function SonificationOptions() {
  const appConfig = useAppConfigContext();
  const { sonify } = appConfig;
  const { dotPlotMode } = sonify;

  const handleDotPlotModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    sonify.setDotPlotMode(e.target.value);
  };

  return (
    <>
      <div className="control-panel-section" role="group" aria-labelledby="dot-plot-options-heading" data-testid="dot-plot-options">
        <h3 id="dot-plot-options-heading">Dot Plot</h3>
        <div className="user-option">
          <div role="radiogroup" aria-label="Dot plot tone options">
            <div className="user-option">
              <input
                type="radio"
                id="continual-tone"
                name="dot-plot-tone"
                value={DotPlotMode.CONTINUAL}
                checked={dotPlotMode === DotPlotMode.CONTINUAL}
                onChange={handleDotPlotModeChange}
                data-testid="continual-tone-option"
              />
              <label
                data-testid="continual-tone-label"
                htmlFor="continual-tone"
              >
                Continual tone set by count in each bin
              </label>
            </div>

            <div className="user-option">
              <input
                type="radio"
                id="each-dot-tone"
                name="dot-plot-tone"
                value={DotPlotMode.EACH_DOT}
                checked={dotPlotMode === DotPlotMode.EACH_DOT}
                onChange={handleDotPlotModeChange}
                data-testid="each-dot-tone-option"
              />
              <label
                data-testid="each-dot-tone-label"
                htmlFor="each-dot-tone"
              >
                Each dot gets a sharp quick tone.
              </label>
            </div>
          </div>
        </div>
      </div>
      <div className="control-panel-section" role="group" aria-labelledby="scatter-plot-options-heading" data-testid="scatter-plot-options">
        <h3 id="scatter-plot-options-heading">Scatter Plot</h3>
        <div>No options available</div>
      </div>
    </>
  );
});
