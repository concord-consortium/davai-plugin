import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import { CodapItem } from "../types";
import { removeRoiAdornment, updateRoiAdornment } from "./graph-sonification-utils";
import { ErrorMessage } from "./error-message";

import PlayIcon from "../assets/play-sonification-icon.svg";
import PauseIcon from "../assets/pause-sonification-icon.svg";
import ResetIcon from "../assets/reset-sonification-icon.svg";
import LoopIcon from "../assets/loop-sonification-icon.svg";
import LoopOffIcon from "../assets/not-loop-sonification-icon.svg";

import "./graph-sonification.scss";

interface IProps {
  availableGraphs: Record<string, any>[];
  selectedGraph?: Record<string, any>;
  onSelectGraph: (graph: Record<string, any>) => Promise<void>;
}

const kDefaultDuration = 5;

export const GraphSonification = ({availableGraphs, selectedGraph, onSelectGraph}: IProps) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);
  const isLoopingRef = useRef(false);
  const duration = useRef(kDefaultDuration);

  const [showError, setShowError] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [timeValues, setTimeValues] = useState<number[]>([]);
  const [timeFractions, setTimeFractions] = useState<number[]>([]);
  const [pitchFractions, setPitchFractions] = useState<number[]>([]);
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

  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  const handlePlayEnd = useCallback(() => {
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, paused: false, ended: true, position });
  }, []);

  const scheduleTones = useCallback(() => {
    if (!selectedGraph) return;
    const fractionGroups: Record<number, number[]> = {};
    timeFractions.forEach((frac: number, i: number) => {
      if (!fractionGroups[frac]) fractionGroups[frac] = [];
      fractionGroups[frac].push(i);
    });

    const uniqueFractions = Object.keys(fractionGroups)
      .map(parseFloat)
      .sort((a, b) => a - b);

    uniqueFractions.forEach((fraction) => {
      // to-do: use the width of the line in calculation of offset
      const offsetSeconds = fraction * duration.current;
      const indices = fractionGroups[fraction];

      Tone.getTransport().scheduleOnce((time) => {
        indices.forEach((i) => {
          const pFrac = pitchFractions[i];
          const lowerFreqBound = 220;
          const upperFreqBound = 880;
          const freq = lowerFreqBound + pFrac * (upperFreqBound - lowerFreqBound);
          // For each data point, determine the pan value based on the x-axis position.
          // Normalize the x-axis position to a value between -1 and 1.
          const { xLowerBound, xUpperBound } = selectedGraph;
          const panValue = ((timeValues[i] - xLowerBound) / (xUpperBound - xLowerBound)) * 2 - 1;
          pannerRef.current?.pan.setValueAtTime(panValue, time);
          synthRef.current?.triggerAttackRelease(freq, "8n", time);
        });
      }, offsetSeconds);
    });
  }, [duration, selectedGraph, pitchFractions, timeFractions, timeValues]);

  const restartTransport = () => {
    Tone.getTransport().seconds = 0;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();
  };

  const animateSonification = useCallback(() => {
    if (!selectedGraph) return;
    const step = () => {
      const elapsed = Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / duration.current, 1);

      updateRoiAdornment(selectedGraph.id, fraction);

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
        updateRoiAdornment(selectedGraph.id, 0);
        scheduleTones();
        restartTransport();
        frameIdRef.current = requestAnimationFrame(step);
      }
    };

    frameIdRef.current = requestAnimationFrame(step);
  }, [duration, selectedGraph, handlePlayEnd, scheduleTones]);

  const prepareSonification = useCallback(async () => {
      if (!selectedGraph) return;

      if (currentGraphIdRef.current && currentGraphIdRef.current !== selectedGraph.id) {
        await removeRoiAdornment(currentGraphIdRef.current);
      }

      currentGraphIdRef.current = selectedGraph.id;
      await Tone.start();
      scheduleTones();

      // to-do: calculate extent based on width of graph
      await codapInterface.sendRequest({
        action: "create",
        resource: `component[${selectedGraph.id}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": 0, "extent": 0.05 },
          secondary: { "position": 0, "extent": "100%" }
        }
      });

      restartTransport();
      animateSonification();

  }, [animateSonification, selectedGraph, scheduleTones]);

  const handlePlayPauseClick = () => {
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
    if (isAtBeginning) return;

    setPlayState({ playing: false, paused: false, ended: false, position: 0 });
    updateRoiAdornment(selectedGraph?.id, 0);
    Tone.getTransport().stop();
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
    }
  };

  const handleSelectGraph =  async (graphId: string) => {
    if (graphId === selectedGraph?.id) return;

    handleReset();

    const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphId}]`}) as IResult;
    const graphDetails = res.values;
    onSelectGraph(graphDetails);

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
    const timeVals: number[] = validItems.map((item: CodapItem) => item.values[timeAttr]);

    const timeRange = graphDetails.xUpperBound - graphDetails.xLowerBound || 1;
    const pitchRange = graphDetails.yUpperBound - graphDetails.yLowerBound || 1;

    setTimeValues(timeVals);
    setTimeFractions(timeVals.map((value: number) => (value - graphDetails.xLowerBound) / timeRange));
    setPitchFractions(pitchValues.map((value: number) => (value - graphDetails.yLowerBound) / pitchRange));
  };

  const handleToggleLoop = () => {
    setIsLooping(!isLooping);
  };

  const handleSetSpeed = (s: number) => {
    if (playState.playing) return;
    setSpeed(s);
  };

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    duration.current = kDefaultDuration / speed;
  }, [speed]);

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
          onClick={handlePlayPauseClick}
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
};
