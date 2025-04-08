import React from "react";

import PlayIcon from "../assets/play-sonification-icon.svg";
import PauseIcon from "../assets/pause-sonification-icon.svg";
import ResetIcon from "../assets/reset-sonification-icon.svg";
import LoopIcon from "../assets/loop-sonification-icon.svg";
import LoopOffIcon from "../assets/not-loop-sonification-icon.svg";

import "./graph-sonification-controls.scss";

interface IProps {
  availableGraphs: string[];
  graphToSonify: string;
  isSonificationLooping: boolean;
  isSonificationPlaying: boolean;
  sonifySpeed?: number;
  sonificationStep: number;
  onPauseSonification: (step: number) => void;
  onSelectGraph: (graphName: string) => void;
  onSetLoopSonification: () => void;
  onSetSonifySpeed: (speed: number) => void;
  onSonifyGraph: () => void;
}

export const GraphSonificationControls = (props: IProps) => {
  const { availableGraphs, graphToSonify, isSonificationLooping, isSonificationPlaying, sonifySpeed, sonificationStep,
    onPauseSonification, onSelectGraph, onSetLoopSonification, onSetSonifySpeed, onSonifyGraph } = props;

  const handlePlayPauseClick = () => {
    if (isSonificationPlaying) {
      onPauseSonification(sonificationStep);
    } else {
      onSonifyGraph();
    }
  };

  return (
    <div className="graph-sonification-controls">
      <div className="graph-selection">
        <label htmlFor="graph-select">Select a graph to sonify:</label>
        <select id="graph-select" value={graphToSonify} onChange={(e) => onSelectGraph(e.target.value)}>
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
          { isSonificationPlaying ? <PauseIcon /> : <PlayIcon /> }
          <span>{isSonificationPlaying ? "Pause" : "Play" }</span>
        </button>
        <button className={`reset ${!isSonificationPlaying && "disabled"}`}>
          <ResetIcon />
          <span>Reset</span>
        </button>
        <button className="repeat" onClick={onSetLoopSonification}>
          {isSonificationLooping ? <LoopIcon /> : <LoopOffIcon /> }
          <span>{isSonificationLooping ? "Repeat On" : "Repeat Off" }</span>
        </button>
        <div className="sonify-speed-control">
          <select id="speed-select" value={sonifySpeed} onChange={(e) => onSetSonifySpeed(parseFloat(e.target.value))}>
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
};
