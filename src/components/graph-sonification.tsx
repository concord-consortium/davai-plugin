import React, { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { autorun } from "mobx";
import * as Tone from "tone";
import { ErrorMessage } from "./error-message";
import { createRoiAdornment, updateRoiAdornment } from "../utils/graph-sonification-utils";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
import { useRootStore } from "../contexts/root-store-context";
import { SonificationOptions } from "./sonification-options";

import PlayIcon from "../assets/play-sonification-icon.svg";
import PauseIcon from "../assets/pause-sonification-icon.svg";
import ResetIcon from "../assets/reset-sonification-icon.svg";
import LoopIcon from "../assets/loop-sonification-icon.svg";
import LoopOffIcon from "../assets/not-loop-sonification-icon.svg";

import "./graph-sonification.scss";

export const GraphSonification = observer(() => {
  const { sonificationStore, transportManager } = useRootStore();
  const {
    validGraphs,
    selectedGraph,
    setSelectedGraphID,
    timeFractions,
    timeValues,
    pitchFractions,
    primaryBounds,
    binValues
  } = sonificationStore;
  const { bins, minBinEdge, maxBinEdge, binWidth } = binValues || {};

  const shortcutsService = useShortcutsService();

  const playPauseButtonRef = useRef<HTMLButtonElement>(null);

  const [showError, setShowError] = useState(false);

  const selectedGraphID = selectedGraph?.id;

  useEffect(() => {
    return () => {
      // Ensure the transport and its schedulers are stopped when unmounting
      transportManager.reset();
    };
   }, [transportManager]);

  const reset = useCallback(() => {
    transportManager.reset();

    if (selectedGraphID) {
      createRoiAdornment(selectedGraphID);
    }

  }, [selectedGraphID, transportManager]);

  useEffect(() => {
    // reset the sonification state and re-add the ROI adornment when there are updates to the data
    reset();
  }, [timeFractions, timeValues, pitchFractions, primaryBounds, bins, minBinEdge, maxBinEdge, binWidth, reset]);

  // Keep Roi Adornment in sync with transport position
  useEffect(() => {
    return autorun(() => {
      if (!selectedGraphID) return;
      updateRoiAdornment(selectedGraphID, transportManager.position / transportManager.duration);
    });
  }, [selectedGraphID, transportManager]);

  const handlePlayPause = useCallback(() => {
    if (!selectedGraphID) {
      setShowError(true);
      return;
    }
    setShowError(false);

    transportManager.playPause();
  }, [selectedGraphID, transportManager]);

  // Save handlePlayPause as a ref for the shortcut handler. This avoids re-registering the shortcut on
  // every render.
  // In React 19 this would be better handled by useEffectEvent
  const handlePlayPauseRef = useRef(handlePlayPause);
  useEffect(() => {
    handlePlayPauseRef.current = handlePlayPause;
  }, [handlePlayPause]);

  // Register keyboard shortcut for play/pause
  useEffect(() => {
    return shortcutsService.registerShortcutHandler("sonifyGraph", (event) => {
      event.preventDefault();

      handlePlayPauseRef.current();
      playPauseButtonRef.current?.focus();
      playPauseButtonRef.current?.scrollIntoView({behavior: "smooth", block: "nearest"});
    }, { focus: true });
  }, [shortcutsService]);

  const handleToggleLoop = () => {
    transportManager.setLooping(!transportManager.looping);
  };

  const handleSetSpeed = (newSpeed: number) => {
    transportManager.setSpeed(newSpeed);
  };

  const handleSelectGraph =  async (graphId: string) => {
    const graphIdAsNum = Number(graphId);

    if (graphIdAsNum !== selectedGraphID) {
      setSelectedGraphID(graphIdAsNum);
      reset();
    }
  };

  const renderGraphOptions = () => {
    const graphOptions = validGraphs || [];

    return graphOptions.map((graph, i) => {
      let displayName = graph.name || graph.title || graph.dataContext;
      const graphsWithSameName = graphOptions.filter((g) =>
        (g.name || g.title || g.dataContext) === (graph.name || graph.title || graph.dataContext)
      );
      const displayIndex = graphsWithSameName.findIndex((g) => g.id === graph.id);
      if (graphsWithSameName.length > 1) {
        displayName += ` (${displayIndex + 1})`;
      }

      return (
        <option key={i} value={graph.id}>
          {displayName}
        </option>
      );
    });
  };

  const { speed, looping, isPlaying, isAtBeginning } = transportManager;

  return (
    <div className="graph-sonification control-panel" role="group" aria-labelledby="control-panel-heading">
      <h2 id="control-panel-heading">Sonification</h2>
      <div className="graph-selection">
        <label htmlFor="graph-select">Graph to sonify:</label>
        <select id="graph-select" value={selectedGraphID || ""} onChange={(e) => handleSelectGraph(e.target.value)}>
          <option value={""} disabled>Select a graph</option>
          {renderGraphOptions()}
        </select>
      </div>
      <div className="sonification-buttons">
        <button
          ref={playPauseButtonRef}
          className="play"
          data-testid="playback-button"
          onClick={handlePlayPause}
          aria-disabled={!selectedGraphID}
        >
          { isPlaying ? <PauseIcon /> : <PlayIcon /> }
          <span>{isPlaying ? "Pause" : "Play" }</span>
        </button>
        <button
          className={`reset ${isAtBeginning && "disabled"}`}
          data-testid="reset-button"
          onClick={reset}
          aria-disabled={isAtBeginning}
        >
          <ResetIcon />
          <span>Reset</span>
        </button>
        <button
          className="repeat"
          data-testid="repeat-button"
          onClick={handleToggleLoop}
          role="switch"
          aria-checked={looping}
          aria-label="Loop Playback"
        >
          {looping ? <LoopIcon /> : <LoopOffIcon /> }
          <span>Repeat</span>
        </button>
        <div className="sonify-speed-control">
          <select
            aria-label="Playback Speed"
            id="speed-select"
            value={speed}
            onChange={(e) => handleSetSpeed(parseFloat(e.target.value))}
          >
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <label htmlFor="speed-select">Speed</label>
        </div>
      </div>
      {showError && <ErrorMessage slug={"sonification"} message={"Please select a graph to sonify."} />}
      <SonificationOptions />
    </div>
  );
});
