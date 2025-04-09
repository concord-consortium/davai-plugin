import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { observer } from "mobx-react-lite";
import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import { CodapItem } from "../types";
import { removeRoiAdornment, updateRoiAdornment } from "./graph-sonification-utils";

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

export const GraphSonification = observer((props: IProps) => {
  const { availableGraphs, sonificationStore } = props;
  const { selectedGraph } = sonificationStore;

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);
  const isLoopingRef = useRef(false);
  const duration = useRef(kDefaultDuration);

  // const [isPlaying, setIsPlaying] = useState(false);
  // const [isPaused, setIsPaused] = useState(false);
  // const [startFromPause, setStartFromPause] = useState(false);
  // const [hasEnded, setHasEnded] = useState(false);
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
    // setIsPlaying(false);
    // setIsPaused(false);
    // setHasEnded(true);
    // setStartFromPause(false);
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, paused: false, ended: true, position });
  }, []);

  const scheduleTones = useCallback(() => {
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
          const panValue = ((timeValues[i] - selectedGraph.xLowerBound) / (selectedGraph.xUpperBound - selectedGraph.xLowerBound)) * 2 - 1;
          pannerRef.current?.pan.setValueAtTime(panValue, time);
          synthRef.current?.triggerAttackRelease(freq, "8n", time);
        });
      }, offsetSeconds);
    });
  }, [duration, selectedGraph.xLowerBound, selectedGraph.xUpperBound, pitchFractions, timeFractions, timeValues]);

  const restartTransport = () => {
    Tone.getTransport().seconds = 0;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();
  };

  const animateSonification = useCallback(() => {
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
  }, [duration, selectedGraph.id, handlePlayEnd, scheduleTones]);

  const prepareSonification = useCallback(async () => {
      if (!selectedGraph) return;

      if (currentGraphIdRef.current && currentGraphIdRef.current !== selectedGraph.id) {
        await removeRoiAdornment(currentGraphIdRef.current);
      }

      currentGraphIdRef.current = selectedGraph.id;
      await Tone.start();
      scheduleTones();

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
    if (playState.ended || isAtBeginning) {
      prepareSonification();
      // setHasEnded(false);
      // setIsPlaying(true);
      // setIsPaused(false);
      const position = Tone.getTransport().seconds;
      setPlayState({ playing: true, paused: false, ended: false, position });
      return;
    }

    if (playState.position !== 0 && !playState.playing) {
      // setIsPlaying(true);
      // setIsPaused(false);
      // setStartFromPause(false);
      const position = Tone.getTransport().seconds;
      setPlayState({ playing: true, paused: false, ended: false, position });
      animateSonification();
      Tone.getTransport().start();
      return;
    }

    if (playState.playing) {
      // setIsPaused(true);
      // setIsPlaying(false);
      // setStartFromPause(true);
      const position = Tone.getTransport().seconds;
      setPlayState({ playing: false, paused: true, ended: false, position });
      Tone.getTransport().pause();
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    }
  };

  const handleReset = () => {
    if (isAtBeginning) return;

    // setHasEnded(false);
    // setIsPlaying(false);
    // setIsPaused(false);
    // setStartFromPause(false);
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, paused: false, ended: false, position });
    updateRoiAdornment(selectedGraph.id, 0);
    Tone.getTransport().stop();
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
    }
  };

  const handleSelectGraph =  async (graphId: string) => {
    if (graphId === selectedGraph.id) return;

    handleReset();

    const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphId}]`}) as IResult;
    const graphDetails = res.values;
    sonificationStore.setSelectedGraph(graphDetails);

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
    setIsLooping((prev) => !prev);
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
    <div className="graph-sonification">
      <div className="options-header">
        <h2 className="options-heading">Sonification</h2>
      </div>
      <div className="graph-selection">
        <label htmlFor="graph-select">Graph to sonify:</label>
        <select id="graph-select" value={selectedGraph.id || ""} onChange={(e) => handleSelectGraph(e.target.value)}>
          <option value="" disabled>Select a graph</option>
          {availableGraphs.map((graph) => (
            <option key={graph.id} value={graph.id}>
              {graph.name || graph.title || graph.id}
            </option>
          ))}
        </select>
      </div>
      <div className="sonification-buttons">
        <button className="play" onClick={handlePlayPauseClick}>
          { playState.playing ? <PauseIcon /> : <PlayIcon /> }
          <span>{playState.playing ? "Pause" : "Play" }</span>
        </button>
        <button
          className={`reset ${isAtBeginning && "disabled"}`}
          onClick={handleReset}
          aria-disabled={isAtBeginning}
        >
          <ResetIcon />
          <span>Reset</span>
        </button>
        <button
          className="repeat"
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
    </div>
  );
});
