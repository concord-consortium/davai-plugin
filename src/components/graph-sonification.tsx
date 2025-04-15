import React, { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import * as Tone from "tone";
import { codapInterface, IResult } from "@concord-consortium/codap-plugin-api";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { removeRoiAdornment, mapPitchFractionToFrequency, mapValueToStereoPan, updateRoiAdornment } from "./graph-sonification-utils";
import { ErrorMessage } from "./error-message";

import PlayIcon from "../assets/play-sonification-icon.svg";
import PauseIcon from "../assets/pause-sonification-icon.svg";
import ResetIcon from "../assets/reset-sonification-icon.svg";
import LoopIcon from "../assets/loop-sonification-icon.svg";
import LoopOffIcon from "../assets/not-loop-sonification-icon.svg";

import "./graph-sonification.scss";

interface IProps {
  availableGraphs: Record<string, any>[];
  sonificationStore: GraphSonificationModelType;
}

const kDefaultDuration = 5;

export const GraphSonification = observer(({availableGraphs, sonificationStore}: IProps) => {
  const { selectedGraph, setSelectedGraph, setGraphItems, getTimeFractions, getTimeValues,
    getPitchFractions, getPrimaryBounds } = sonificationStore;
  const polySynthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);
  const isLoopingRef = useRef(false);
  const durationRef = useRef(kDefaultDuration);

  const [showError, setShowError] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [playState, setPlayState] = useState({
    playing: false,
    paused: false,
    position: 0,
    ended: false
  });

  const isAtBeginning = !playState.playing && !playState.paused && !playState.ended;

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!polySynthRef.current) {
    polySynthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  const handlePlayPause = () => {
    if (!selectedGraph?.id) {
      setShowError(true);
      return;
    } else {
      setShowError(false);
    }

    if (playState.ended || isAtBeginning) {
      prepareSonification();
      setPlayState({ playing: true, paused: false, ended: false, position: 0 });
      return;
    }

    setPlayState(prev => {
      const position = Tone.getTransport().seconds;
      // if we were paused, resume
      if (!prev.playing) {
        animateSonification();
        Tone.getTransport().start();
        return {
          ...prev,
          playing: true,
          paused: false,
          ended: false,
          position,
        };
      }
      // otherwise, pause
      Tone.getTransport().pause();
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
      return {
        ...prev,
        playing: false,
        paused: true,
        ended: false,
        position,
      };
    });
  };

  const handleReset = () => {
    if (isAtBeginning || !selectedGraph) return;

    setPlayState({ playing: false, paused: false, ended: false, position: 0 });
    updateRoiAdornment(`${selectedGraph.id}`, 0);
    Tone.getTransport().stop();

    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
    }
  };

  const handleToggleLoop = () => {
    setIsLooping(!isLooping);
  };

  const handleSetSpeed = (s: number) => {
    if (playState.playing) return;
    setSpeed(s);
  };

  const handlePlayEnd = useCallback(() => {
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, paused: false, ended: true, position });
  }, []);

  const restartTransport = () => {
    Tone.getTransport().seconds = 0;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();
  };

  const scheduleTones = useCallback(() => {
    if (!selectedGraph) return;
    const fractionGroups: Record<number, number[]> = {};
    const timeValues = getTimeValues() || [];

    const timeFractions = getTimeFractions() || [];
    const pitchFractions = getPitchFractions() || [];
    const primaryBounds = getPrimaryBounds();
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
  }, [durationRef, selectedGraph, getTimeFractions, getTimeValues, getPitchFractions, getPrimaryBounds]);

  const animateSonification = useCallback(() => {
    if (!selectedGraph) return;
    const step = () => {
      const elapsed = Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / durationRef.current, 1);

      updateRoiAdornment(`${selectedGraph.id}`, fraction);

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
        updateRoiAdornment(`${selectedGraph.id}`, 0);
        scheduleTones();
        restartTransport();
        frameIdRef.current = requestAnimationFrame(step);
      }
    };

    frameIdRef.current = requestAnimationFrame(step);
  }, [durationRef, selectedGraph, handlePlayEnd, scheduleTones]);

  const prepareSonification = async () => {
      if (!selectedGraph) return;

      if (currentGraphIdRef.current && currentGraphIdRef.current !== `${selectedGraph.id}`) {
        await removeRoiAdornment(currentGraphIdRef.current);
      }

      currentGraphIdRef.current = `${selectedGraph.id}`;

      await codapInterface.sendRequest({
        action: "create",
        resource: `component[${selectedGraph.id}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": "0%", "extent": "0.05%" }, // 0.05% consistently approximates 1 pixel
          secondary: { "position": "0%", "extent": "100%" }
        }
      });

      restartTransport();
      animateSonification();
  };

  const handleSelectGraph =  async (graphId: string) => {
    if (graphId === `${selectedGraph?.id}`) return;

    handleReset();

    const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphId}]`}) as IResult;
    const graphDetails = res.values;
    setSelectedGraph(graphDetails);
    setGraphItems(graphDetails.dataContext);
  };

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    durationRef.current = kDefaultDuration / speed;
  }, [speed]);

  useEffect(() => {
    return () => {
      // Ensure requestAnimationFrame is cancelled if the component unmounts during playback
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, []);

  return (
    <div className="graph-sonification control-panel" role="group" aria-labelledby="control-panel-heading">
      <h2 id="control-panel-heading">Sonification</h2>
      <div className="graph-selection">
        <label htmlFor="graph-select">Graph to sonify:</label>
        <select id="graph-select" value={selectedGraph?.id || ""} onChange={(e) => handleSelectGraph(e.target.value)}>
          <option value="" disabled>Select a graph</option>
          {availableGraphs.map((graph) => (
            <option key={graph.id} value={graph.id}>
              {graph.name || graph.title || graph.id}
            </option>
          ))}
        </select>
      </div>
      <div className="sonification-buttons">
        <button
          className="play"
          data-testid="playback-button"
          onClick={handlePlayPause}
          aria-disabled={!selectedGraph}
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
