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
    pitchFractions, primaryBounds, binValues } = sonificationStore;
  const gain = useRef<Tone.Gain | null>(null);
  const osc = useRef<Tone.Oscillator | null>(null);
  const pan = useRef<Tone.Panner | null>(null);
  const poly = useRef<Tone.PolySynth | null>(null);
  const frame = useRef<number | null>(null);
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

  useEffect(() => {
    pan.current   = new Tone.Panner(0);
    gain.current  = new Tone.Gain(1).toDestination().connect(pan.current);
    poly.current  = new Tone.PolySynth().connect(gain.current);
    osc.current   = new Tone.Oscillator(220, "sine").connect(gain.current);

    return () => {
      // Ensure requestAnimationFrame is cancelled if the component unmounts during playback
      if (frame.current) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
   }, []);

   useEffect(() => {
    // reset the sonification state when the selected graph changes
    setPlayState({ playing: false, ended: false, position: 0 });
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    Tone.getTransport().position = 0;

    if (osc.current) {
      osc.current.stop();
    }

    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, [selectedGraphID, setGraphItems]);

  useEffect(() => { isLoopingRef.current = isLooping; }, [isLooping]);
  useEffect(() => { durationRef.current = kDefaultDuration / speed; }, [speed]);

  const restartTransport = () => {
    Tone.getTransport().seconds = 0;
    Tone.getTransport().position = 0;
    Tone.getTransport().start();
  };

  const handlePlayEnd = useCallback(() => {
    const position = Tone.getTransport().seconds;
    setPlayState({ playing: false, ended: true, position });
  }, []);

  const scheduleUnivariate = useCallback(() => {
    if (!binValues || !selectedGraph || !primaryBounds) return;
    const { bins, minBinEdge, maxBinEdge, binWidth } = binValues;
    const binDuration = durationRef.current / bins.length;
    const maxCount = (Math.max(...bins) || 1);

    const getBinPanValue = (i: number) => {
      const binAvgForPanValue = minBinEdge + (i + 0.5) * binWidth;
      return mapValueToStereoPan(binAvgForPanValue, minBinEdge, maxBinEdge);
    };

    osc.current?.start();

    if (osc.current) {
      osc.current.mute = false;
    }

    bins.forEach((count, i) => {
      const offset = i * binDuration;
      const prevValue = i === 0 ? undefined : bins[i - 1];
      const rampTime = count === 0 ? 0.01 : binDuration / 4;
      Tone.getTransport().scheduleOnce((time) => {
        const countFraction = count / maxCount;
        const freq = mapPitchFractionToFrequency(countFraction);
        const panValue = getBinPanValue(i);
        pan.current?.pan.setValueAtTime(panValue, time);
        osc.current?.frequency.rampTo(freq, rampTime, time);
        if (count === 0) {
          gain.current?.gain.rampTo(0, rampTime, time);
        } else if (prevValue === 0) {
          gain.current?.gain.rampTo(1, rampTime, time);
        }
      }, offset);
    });

    Tone.getTransport().scheduleOnce((time) => {
      osc.current?.stop(time);
    }, durationRef.current);
  }, [binValues, primaryBounds, selectedGraph]);

  const scheduleScatter = useCallback(() => {
    if (!selectedGraph || !primaryBounds) return;

    const fractionGroups: Record<number, number[]> = {};
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
          pan.current?.pan.setValueAtTime(panValue, time);
          poly.current?.triggerAttackRelease(freq, "8n", time);
        });
      }, offsetSeconds);
    });
  }, [selectedGraph, primaryBounds, timeFractions, pitchFractions, timeValues]);

  const scheduleTones = useCallback(() => {
    if (!selectedGraph) return;
    if (selectedGraph.isScatterPlot) {
      scheduleScatter();
    } else if (selectedGraph.isUnivariateDotPlot) {
      scheduleUnivariate();
    }
  }, [scheduleScatter, scheduleUnivariate, selectedGraph]);

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
        Tone.getTransport().stop();
      } else {
        updateRoiAdornment(`${selectedGraphID}`, 0);
        scheduleTones();
        restartTransport();
        frame.current = requestAnimationFrame(step);
      }
    };

    frame.current = requestAnimationFrame(step);
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
        if (osc.current) {
          osc.current.mute = false;
        }
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
      if (osc.current) {
        osc.current.mute = true;
      }
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
    Tone.getTransport().stop();
    osc.current?.stop();

    if (frame.current) {
      cancelAnimationFrame(frame.current);
    }
  };

  const handleToggleLoop = () => {
    setIsLooping(!isLooping);
  };

  const handleSetSpeed = (newSpeed: number) => {
    const isPlaying = playState.playing;
    const isPaused = !playState.playing && !playState.ended;

    const oldFraction = Tone.getTransport().seconds / durationRef.current;
    const newDuration = kDefaultDuration / newSpeed;

    durationRef.current = newDuration;
    setSpeed(newSpeed);

    if (isPlaying || isPaused) {
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
      animateSonification(); // picks up at new speed
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
