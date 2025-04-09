import React from "react";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { observer } from "mobx-react-lite";
import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import { CodapItem } from "../types";
import { updateRoiAdornment } from "./graph-sonification-utils";

import PlayIcon from "../assets/play-sonification-icon.svg";
import PauseIcon from "../assets/pause-sonification-icon.svg";
import ResetIcon from "../assets/reset-sonification-icon.svg";
import LoopIcon from "../assets/loop-sonification-icon.svg";
import LoopOffIcon from "../assets/not-loop-sonification-icon.svg";

import "./graph-sonification-controls.scss";

interface IProps {
  availableGraphs: string[];
  sonificationStore: GraphSonificationModelType;
}

export const GraphSonificationControls = observer((props: IProps) => {
  const { availableGraphs, sonificationStore } = props;
  const { graphToSonify, isPlaying, isPaused, startFromPause, isLooping, sonifySpeed } = sonificationStore;

  const handlePlayPauseClick = () => {
    if (isPlaying) {
      sonificationStore.setIsPaused(true);
      sonificationStore.setIsPlaying(false);
      sonificationStore.setStartFromPause(true);
      return;
    }

    if (isPaused) {
      sonificationStore.setIsPaused(false);
      sonificationStore.setStartFromPause(true);
    }

    sonificationStore.setIsPlaying(true);
  };

  const handleReset = () => {
    sonificationStore.setIsPlaying(false);
    sonificationStore.setIsPaused(false);
    sonificationStore.setStartFromPause(false);
    updateRoiAdornment(graphToSonify, 0);
  };

  const handleSelectGraph =  async (graphName: string) => {
    sonificationStore.setGraphToSonify(graphName);
    const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphName}]`}) as IResult;
    const graphDetails = res.values;
    const pitchAttr = graphDetails.yAttributeName;
    const timeAttr = graphDetails.xAttributeName;
    const allItemsRes = await getAllItems(graphDetails.dataContext);
    const allItems = allItemsRes.values;
    // Asign pitch and time values to the dataset items -- do not include items that are missing values for
    // either attribute.
    const validItems = pitchAttr && timeAttr
      ? allItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
      : allItems.filter((item: CodapItem) => item.values[timeAttr] !== "");
    const pitchValues: number[] = validItems.map((item: CodapItem) => item.values[pitchAttr]);
    const timeValues: number[] = validItems.map((item: CodapItem) => item.values[timeAttr]);
    const minTime = graphDetails.xLowerBound;
    const maxTime = graphDetails.xUpperBound;
    const timeRange = maxTime - minTime || 1;
    const minPitch = graphDetails.yLowerBound;
    const maxPitch = graphDetails.yUpperBound;
    const pitchRange = maxPitch - minPitch || 1;
    sonificationStore.setTimeValues(timeValues);
    sonificationStore.setTimeFractions(timeValues.map((value: number) => (value - minTime) / timeRange));
    sonificationStore.setPitchFractions(pitchValues.map((value: number) => (value - minPitch) / pitchRange));
    sonificationStore.setGraphInfo(graphDetails);
  };

  const handleToggleLoop = () => {
    sonificationStore.setIsLooping(!sonificationStore.isLooping);
  };

  const handleSetSpeed = (speed: number) => {
    sonificationStore.setSpeed(speed);
  };

  return (
    <div className="graph-sonification-controls">
      <div className="graph-selection">
        <label htmlFor="graph-select">Select a graph to sonify:</label>
        <select id="graph-select" value={graphToSonify} onChange={(e) => handleSelectGraph(e.target.value)}>
          <option value="">...</option>
          {availableGraphs.map((graph) => (
            <option key={graph} value={graph}>
              {graph}
            </option>
          ))}
        </select>
      </div>
      <div className="sonification-buttons">
        <button className="play" onClick={handlePlayPauseClick}>
          { isPlaying ? <PauseIcon /> : <PlayIcon /> }
          <span>{isPlaying ? "Pause" : "Play" }</span>
        </button>
        <button
          className={`reset ${!startFromPause && "disabled"}`}
          onClick={handleReset}
        >
          <ResetIcon />
          <span>Reset</span>
        </button>
        <button
          className="repeat"
          onClick={handleToggleLoop}
          role="switch"
          aria-checked={isLooping}
        >
          {isLooping ? <LoopIcon /> : <LoopOffIcon /> }
          <span>Repeat</span>
        </button>
        <div className="sonify-speed-control">
          <select id="speed-select" value={sonifySpeed} onChange={(e) => handleSetSpeed(parseFloat(e.target.value))}>
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <label htmlFor="speed-select">Speed</label>
        </div>
      </div>
    </div>
  );
});
