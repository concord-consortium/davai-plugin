import React from "react";
import { observer } from "mobx-react-lite";
import { useAppConfigContext } from "../contexts/app-config-context";
import { DotPlotMode, ScatterPlotContinuousType } from "../models/app-config-model";

export const SonificationOptions: React.FC = observer(function SonificationOptions() {
  const appConfig = useAppConfigContext();
  const { sonify } = appConfig;
  const { dotPlotMode, scatterPlotContinuousType } = sonify;

  const handleDotPlotModeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    sonify.setDotPlotMode(e.target.value);
  };

  const handleScatterPlotContinuousTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    sonify.setScatterPlotContinuousType(e.target.value);
  };

  return (
    <>
      <div className="control-panel-section" role="group" aria-labelledby="dot-plot-options-heading" data-testid="dot-plot-options">
        <h3 id="dot-plot-options-heading">Dot Plot</h3>
        <div className="options-list-1">
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
      </div>
      <div className="control-panel-section" role="group" aria-labelledby="scatter-plot-options-heading" data-testid="scatter-plot-options">
        <h3 id="scatter-plot-options-heading">Scatter Plot</h3>
        <div className="options-list-1">
          <label className="user-option">
            <input
              type="checkbox"
              checked={sonify.scatterPlotEachDot}
              onChange={(e) => sonify.setScatterPlotEachDot(e.target.checked)}
            />
            Sharp, quick tone per dot
          </label>
          <div>
            <label className="user-option">
              <input
                type="checkbox"
                checked={sonify.scatterPlotContinuous}
                onChange={(e) => sonify.setScatterPlotContinuous(e.target.checked)}
              />
              Continual tone for:
            </label>
            <div className="options-list-2">
              <label className="user-option">
                <input
                  type="radio"
                  name="scatter-plot-continuous-type"
                  disabled={!sonify.scatterPlotContinuous}
                  value={ScatterPlotContinuousType.LSRL}
                  checked={scatterPlotContinuousType === ScatterPlotContinuousType.LSRL}
                  onChange={handleScatterPlotContinuousTypeChange}
                />
                Regression Line (LSRL)
              </label>

              <label className="user-option">
                <input
                  type="radio"
                  name="scatter-plot-continuous-type"
                  disabled={!sonify.scatterPlotContinuous}
                  value={ScatterPlotContinuousType.LOESS}
                  checked={scatterPlotContinuousType === ScatterPlotContinuousType.LOESS}
                  onChange={handleScatterPlotContinuousTypeChange}
                />
                Spline (LOESS)
              </label>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
