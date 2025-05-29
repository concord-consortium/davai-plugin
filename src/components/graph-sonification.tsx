import React, { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import * as Tone from "tone";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { createRoiAdornment, updateRoiAdornment } from "./graph-sonification-utils";
import { ErrorMessage } from "./error-message";
import { useTone } from "../hooks/use-tone";
import { useSonificationScheduler } from "../hooks/use-sonification-scheduler";

import PlayIcon from "../assets/play-sonification-icon.svg";
import PauseIcon from "../assets/pause-sonification-icon.svg";
import ResetIcon from "../assets/reset-sonification-icon.svg";
import LoopIcon from "../assets/loop-sonification-icon.svg";
import LoopOffIcon from "../assets/not-loop-sonification-icon.svg";

import "./graph-sonification.scss";

interface IProps {
  sonificationStore: GraphSonificationModelType;
}

const kDefaultDuration = 5;

export const GraphSonification = observer(({sonificationStore}: IProps) => {
  const { validGraphs, selectedGraph, setSelectedGraphID, timeFractions, timeValues,
    pitchFractions, primaryBounds, binValues } = sonificationStore;
  const { bins, minBinEdge, maxBinEdge, binWidth } = binValues || {};

  const durationRef = useRef(kDefaultDuration);
  const frame = useRef<number | null>(null);
  const isLoopingRef = useRef(false);
  const isNewGraph = useRef(false);

  const {osc, gain, pan, poly, part, resetUnivariateSources, cancelAndResetTransport, restartTransport} = useTone();
  const { scheduleTones } = useSonificationScheduler({ selectedGraph, binValues, pitchFractions,
    timeFractions, timeValues, primaryBounds, osc, pan, gain, poly, part, durationRef });

  const [showError, setShowError] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [playState, setPlayState] = useState({
    playing: false,
    position: 0,
    ended: false
  });

  const selectedGraphID = selectedGraph?.id;
  const isAtBeginning = playState.position === 0;

  useEffect(() => {
    return () => {
      // Ensure requestAnimationFrame is cancelled if the component unmounts during playback
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
   }, []);

   useEffect(() => {
    // reset the sonification state when the selected graph changes, or when there are updates to the data
    setPlayState({ playing: false, ended: false, position: 0 });
    updateRoiAdornment(`${selectedGraphID}`, 0);
    cancelAndResetTransport();
    isNewGraph.current = true;

    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, [selectedGraphID, timeFractions, timeValues, pitchFractions, primaryBounds, bins, minBinEdge, maxBinEdge, binWidth, cancelAndResetTransport]);

  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
  useEffect(() => { durationRef.current = kDefaultDuration / speed; }, [speed]);

  const handlePlayEnd = useCallback(() => {
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, ended: true, position });
    Tone.getTransport().stop();
  }, []);

  const animateSonification = useCallback(() => {
    const step = () => {
      const elapsed = Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / durationRef.current, 1);

      updateRoiAdornment(`${selectedGraphID}`, fraction);
      setPlayState(prev => ({ ...prev, position: elapsed }));

      if (fraction < 1) {
        frame.current = requestAnimationFrame(step);
        return;
      }

      if (frame.current && !isLoopingRef.current) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
        handlePlayEnd();
      } else {
        updateRoiAdornment(`${selectedGraphID}`, 0);
        restartTransport();
        frame.current = requestAnimationFrame(step);
      }
    };

    frame.current = requestAnimationFrame(step);
  }, [handlePlayEnd, restartTransport, selectedGraphID]);

  const handlePlayPause = () => {
    if (!selectedGraphID) {
      setShowError(true);
      return;
    }
    setShowError(false);

    if (isNewGraph.current) {
      scheduleTones();
      createRoiAdornment(`${selectedGraphID}`);
      isNewGraph.current = false;
    }

    if (playState.ended || isAtBeginning) {
      setPlayState({ playing: true, ended: false, position: 0 });
      updateRoiAdornment(`${selectedGraphID}`, 0);
      restartTransport();
      animateSonification();
      return;
    }

    setPlayState(prev => {
      const position = Tone.getTransport().seconds;
      // if we were paused, resume
      if (!prev.playing) {
        Tone.getTransport().start();
        animateSonification();
        return {
          playing: true,
          ended: false,
          position
        };
      }
      // otherwise, pause
      Tone.getTransport().pause();
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      return {
        playing: false,
        ended: false,
        position,
      };
    });
  };

  const handleReset = () => {
    if (isAtBeginning || !selectedGraphID) return;

    setPlayState({ playing: false, ended: false, position: 0 });
    updateRoiAdornment(`${selectedGraphID}`, 0);
    isNewGraph.current = true;
    cancelAndResetTransport();
    resetUnivariateSources();

    if (frame.current) {
      cancelAnimationFrame(frame.current);
    }
  };

  const handleToggleLoop = () => {
    setIsLooping(!isLooping);
  };

  const handleSetSpeed = (newSpeed: number) => {
    const isPlaying = playState.playing;
    const isPaused = !playState.playing && !playState.ended && !isAtBeginning;

    const oldDuration = durationRef.current;
    const newDuration = kDefaultDuration / newSpeed;

    durationRef.current = newDuration;
    setSpeed(newSpeed);

    if (isPlaying) {
      // pause to get accurate position in next step
      Tone.getTransport().pause();
    }

    if (isPlaying || isPaused) {
      const oldFraction = Tone.getTransport().seconds / oldDuration;
      // now stop the transport + synced sources and cancel any scheduled events
      Tone.getTransport().stop();
      Tone.getTransport().cancel();

      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }

      scheduleTones();
      const newPositionSeconds = newDuration * oldFraction;
      Tone.getTransport().seconds = newPositionSeconds;
      setPlayState(prev => ({
        ...prev,
        position: newPositionSeconds,
      }));
    }

    if (isPlaying) {
      // if we were playing, restart the transport + animation
      Tone.getTransport().start();
      animateSonification();
    }
  };

  const handleSelectGraph =  async (graphId: string) => {
    setSelectedGraphID(Number(graphId));
  };

  const renderGraphOptions = () => {
    const graphOptions = validGraphs || [];

    return graphOptions.map((graph, i) => {
      let displayName;

      if (graph.name || graph.title) {
        displayName = graph.name || graph.title;
      } else {
        displayName = graph.dataContext || "";
        const graphsWithSameName = graphOptions.filter((g) => g.dataContext === graph.dataContext && !g.name && !g.title);
        const displayIndex = graphsWithSameName.findIndex((g) => g.id === graph.id);
        if (graphsWithSameName.length > 1) {
          displayName += ` (${displayIndex + 1})`;
        }
      }

      return (
        <option key={i} value={graph.id}>
          {displayName}
        </option>
      );
      });
  };

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
          className="play"
          data-testid="playback-button"
          onClick={handlePlayPause}
          aria-disabled={!selectedGraphID}
        >
          { playState.playing ? <PauseIcon /> : <PlayIcon /> }
          <span>{playState.playing ? "Pause" : "Play" }</span>
        </button>
        <button
          className={`reset ${isAtBeginning && "disabled"}`}
          data-testid="reset-button"
          onClick={handleReset}
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
          aria-checked={isLooping}
          aria-label="Loop Playback"
        >
          {isLooping ? <LoopIcon /> : <LoopOffIcon /> }
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
    </div>
  );
});
