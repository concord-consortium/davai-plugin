import React, { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import * as Tone from "tone";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { mapPitchFractionToFrequency, mapValueToStereoPan, updateRoiAdornment } from "./graph-sonification-utils";
import { ErrorMessage } from "./error-message";

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
  const { validGraphs, selectedGraph, setSelectedGraphID, setGraphItems, timeFractions, timeValues,
    pitchFractions, primaryBounds } = sonificationStore;
  const polySynthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const isLoopingRef = useRef(false);
  const durationRef = useRef(kDefaultDuration);
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

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!polySynthRef.current) {
    polySynthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  const handlePlayPause = () => {
    if (!selectedGraphID) {
      setShowError(true);
      return;
    } else {
      setShowError(false);
    }

    if (playState.ended || isAtBeginning) {
      setPlayState({ playing: true, ended: false, position: 0 });
      prepareSonification();
      return;
    }

    setPlayState(prev => {
      const position = Tone.getTransport().seconds;
      // if we were paused, resume
      if (!prev.playing) {
        Tone.getTransport().cancel(); // cancel scheduled events
        scheduleTones(); // reschedule based on updated values
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
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
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
    Tone.getTransport().stop();

    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
    }
  };

  const handleToggleLoop = () => {
    setIsLooping(!isLooping);
  };

  const getCurrentFraction = () => {
    return Tone.getTransport().seconds / durationRef.current;
  };

  const handleSetSpeed = (newSpeed: number) => {
    const isPlaying = playState.playing;
    const isPaused = !playState.playing && !playState.ended;

    const oldFraction = getCurrentFraction(); // store logical progress
    const newDuration = kDefaultDuration / newSpeed;

    durationRef.current = newDuration;
    setSpeed(newSpeed);

    if (isPlaying || isPaused) {
      Tone.getTransport().cancel();

      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }

      scheduleTones();
      const newPositionSeconds = newDuration * oldFraction;
      Tone.getTransport().seconds = newPositionSeconds;
      setPlayState(prev => ({
        ...prev,
        position: newPositionSeconds,
      }));
      animateSonification(); // picks up at new speed
    }
  };

  const handlePlayEnd = useCallback(() => {
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, ended: true, position });
  }, []);

  const restartTransport = () => {
    Tone.getTransport().seconds = 0;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();
  };

  const scheduleTones = useCallback(() => {
    const fractionGroups: Record<number, number[]> = {};

    if (!primaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (!timeLowerBound || !timeUpperBound) return;

    timeFractions.forEach((frac: number, i: number) => {
      if (!fractionGroups[frac]) fractionGroups[frac] = [];
      fractionGroups[frac].push(i);
    });

    const uniqueFractions = Object.keys(fractionGroups)
      .map(parseFloat)
      .sort((a, b) => a - b);

    uniqueFractions.forEach((fraction) => {
      const offsetSeconds = fraction * durationRef.current;
      const indices = fractionGroups[fraction];

      Tone.getTransport().scheduleOnce((time) => {
        indices.forEach((i) => {
          const pFrac = pitchFractions[i];
          const freq = mapPitchFractionToFrequency(pFrac);
          const panValue = mapValueToStereoPan(timeValues[i], timeLowerBound, timeUpperBound);
          pannerRef.current?.pan.setValueAtTime(panValue, time);
          polySynthRef.current?.triggerAttackRelease(freq, "8n", time);
        });
      }, offsetSeconds);
    });
  }, [timeFractions, pitchFractions, timeValues, primaryBounds]);

  const animateSonification = useCallback(() => {
    const step = () => {
      const elapsed = Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / durationRef.current, 1);

      updateRoiAdornment(`${selectedGraphID}`, fraction);
      setPlayState(prev => ({ ...prev, position: elapsed }));

      if (fraction < 1) {
        frameIdRef.current = requestAnimationFrame(step);
        return;
      }

      if (frameIdRef.current && !isLoopingRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
        Tone.getTransport().stop();
        handlePlayEnd();
      } else {
        updateRoiAdornment(`${selectedGraphID}`, 0);
        scheduleTones();
        restartTransport();
        frameIdRef.current = requestAnimationFrame(step);
      }
    };

    frameIdRef.current = requestAnimationFrame(step);
  }, [handlePlayEnd, scheduleTones, selectedGraphID]);

  const prepareSonification = async () => {
      await codapInterface.sendRequest({
        action: "create",
        resource: `component[${selectedGraphID}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": "0%", "extent": "0.05%" }, // 0.05% consistently approximates 1 pixel
          secondary: { "position": "0%", "extent": "100%" }
        }
      });

      scheduleTones();
      restartTransport();
      animateSonification();
  };

  const handleSelectGraph =  async (graphId: string) => {
    handleReset();
    setSelectedGraphID(Number(graphId));
    setGraphItems();
  };

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    durationRef.current = kDefaultDuration / speed;
  }, [speed]);

  useEffect(() => {
    if (!selectedGraphID) {
      // reset everything if no graph is selected
      setPlayState({ playing: false, ended: false, position: 0 });
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      Tone.getTransport().position = 0;

      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    }
  }, [selectedGraphID]);

  useEffect(() => {
    return () => {
      // Ensure requestAnimationFrame is cancelled if the component unmounts during playback
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, []);

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
