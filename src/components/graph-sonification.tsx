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
  availableGraphs: string[];
  sonificationStore: GraphSonificationModelType;
}

const kDefaultDuration = 5;

export const GraphSonification = observer((props: IProps) => {
  const { availableGraphs, sonificationStore } = props;
  const { graphInfo, graphToSonify } = sonificationStore;

  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);
  const isLoopingRef = useRef(false);
  const duration = useRef(kDefaultDuration);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [startFromPause, setStartFromPause] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [timeValues, setTimeValues] = useState<number[]>([]);
  const [timeFractions, setTimeFractions] = useState<number[]>([]);
  const [pitchFractions, setPitchFractions] = useState<number[]>([]);

  const isAtBeginning = !isPlaying && !isPaused && !hasEnded;

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  const handlePlayEnd = useCallback(() => {
    setIsPlaying(false);
    setIsPaused(false);
    setStartFromPause(false);
    setHasEnded(true);
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
          const panValue = ((timeValues[i] - graphInfo.xLowerBound) / (graphInfo.xUpperBound - graphInfo.xLowerBound)) * 2 - 1;
          pannerRef.current?.pan.setValueAtTime(panValue, time);
          synthRef.current?.triggerAttackRelease(freq, "8n", time);
        });
      }, offsetSeconds);
    });
  }, [duration, graphInfo.xLowerBound, graphInfo.xUpperBound, pitchFractions, timeFractions, timeValues]);

  const animateSonification = useCallback(() => {
    const step = () => {
      const elapsed = Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / duration.current, 1);

      updateRoiAdornment(graphToSonify, fraction);

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
        updateRoiAdornment(graphToSonify, 0);
        scheduleTones();
        Tone.getTransport().seconds = 0;
        Tone.getTransport().position = 0;
        Tone.getTransport().start();
        frameIdRef.current = requestAnimationFrame(step);
      }
    };

    frameIdRef.current = requestAnimationFrame(step);
  }, [duration, graphToSonify, handlePlayEnd, scheduleTones]);

  const prepareSonification = useCallback(async () => {
      if (!graphInfo) return;

      if (currentGraphIdRef.current && currentGraphIdRef.current !== graphInfo.id) {
        await removeRoiAdornment(currentGraphIdRef.current);
      }

      currentGraphIdRef.current = graphInfo.id;
      await Tone.start();
      scheduleTones();

      await codapInterface.sendRequest({
        action: "create",
        resource: `component[${graphInfo.id}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": 0, "extent": 0.05 },
          secondary: { "position": 0, "extent": "100%" }
        }
      });

      Tone.getTransport().seconds = 0;
      Tone.getTransport().position = 0;
      Tone.getTransport().start();
      animateSonification();

  }, [animateSonification, graphInfo, scheduleTones]);

  const handlePlayPauseClick = () => {
    if (hasEnded || isAtBeginning) {
      prepareSonification();
      setHasEnded(false);
      setIsPlaying(true);
      setIsPaused(false);
      return;
    }

    if (startFromPause) {
      setIsPlaying(true);
      setIsPaused(false);
      setStartFromPause(false);
      animateSonification();
      Tone.getTransport().start();
      return;
    }

    if (isPlaying) {
      setIsPaused(true);
      setIsPlaying(false);
      setStartFromPause(true);
      Tone.getTransport().pause();
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    }
  };

  const handleReset = () => {
    if (isAtBeginning) return;

    setHasEnded(false);
    setIsPlaying(false);
    setIsPaused(false);
    setStartFromPause(false);
    updateRoiAdornment(graphToSonify, 0);
    Tone.getTransport().stop();
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
    }
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
    const timeValues2: number[] = validItems.map((item: CodapItem) => item.values[timeAttr]);
    const minTime = graphDetails.xLowerBound;
    const maxTime = graphDetails.xUpperBound;
    const timeRange = maxTime - minTime || 1;
    const minPitch = graphDetails.yLowerBound;
    const maxPitch = graphDetails.yUpperBound;
    const pitchRange = maxPitch - minPitch || 1;
    setTimeValues(timeValues2);
    setTimeFractions(timeValues2.map((value: number) => (value - minTime) / timeRange));
    setPitchFractions(pitchValues.map((value: number) => (value - minPitch) / pitchRange));
    sonificationStore.setGraphInfo(graphDetails);
  };

  const handleToggleLoop = () => {
    setIsLooping((prev) => !prev);
  };

  const handleSetSpeed = (s: number) => {
    if (isPlaying) return;
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
        <select id="graph-select" value={graphToSonify} onChange={(e) => handleSelectGraph(e.target.value)}>
          <option value="" disabled>Select a graph</option>
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
