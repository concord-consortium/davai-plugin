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
        <div role="radiogroup" aria-label="Dot plot tone options">
          <label className="user-option">
            <input
              type="radio"
              name="dot-plot-tone"
              value={DotPlotMode.CONTINUAL}
              checked={dotPlotMode === DotPlotMode.CONTINUAL}
              onChange={handleDotPlotModeChange}
            />
            Continual tone tracing shape of distribution
          </label>

          <label className="user-option">
            <input
              type="radio"
              name="dot-plot-tone"
              value={DotPlotMode.EACH_DOT}
              checked={dotPlotMode === DotPlotMode.EACH_DOT}
              onChange={handleDotPlotModeChange}
            />
            Sharp, quick tone per dot
          </label>
        </div>
      </div>
      <div className="control-panel-section" role="group" aria-labelledby="scatter-plot-options-heading" data-testid="scatter-plot-options">
        <h3 id="scatter-plot-options-heading">Scatter Plot</h3>
        <label className="user-option">
          <input
            type="checkbox"
            checked={sonify.scatterPlotEachDot}
            onChange={(e) => sonify.setScatterPlotEachDot(e.target.checked)}
          />
          Sharp, quick tone per dot
        </label>
        <label className="user-option">
          <input
            type="checkbox"
            checked={sonify.scatterPlotLSRL}
            onChange={(e) => sonify.setScatterPlotLSRL(e.target.checked)}
          />
          Continual tone for LSRL
        </label>
      </div>
    </>
  );
});
