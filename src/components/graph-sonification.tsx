import { codapInterface } from "@concord-consortium/codap-plugin-api";
import React, { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { GraphSonificationModelType } from "../models/graph-sonification-model";
import { observer } from "mobx-react-lite";
import { updateRoiAdornment, removeRoiAdornment } from "./graph-sonification-utils";

interface IProps {
  sonificationStore: GraphSonificationModelType;
}

export const GraphSonification = observer(({sonificationStore}: IProps) => {
  const { graphToSonify, graphInfo, isPlaying, isPaused, startFromPause,
    isLooping, pitchFractions, timeFractions, timeValues, duration, handlePlayEnd} = sonificationStore;
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);
  const isLoopingRef = useRef(isLooping);

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

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
      const offsetSeconds = fraction * duration;
      const indices = fractionGroups[fraction];

      Tone.getTransport().scheduleOnce((time) => {
        indices.forEach((i) => {
          const pFrac = pitchFractions[i];
          // TODO: Make these variables with meaningful names for these numbers.
          const freq = 220 + pFrac * (880 - 220);
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
      const fraction = Math.min(elapsed / duration, 1);

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


  useEffect(() => {
    if (isPlaying && !startFromPause) {
      prepareSonification();
    } else if (isPaused) {
      Tone.getTransport().pause();
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    } else if (isPlaying && startFromPause) {
      animateSonification();
      Tone.getTransport().start();
    }
  }, [graphToSonify, isPlaying, isPaused, startFromPause, prepareSonification, animateSonification]);

  return (
    <div hidden={true}/>
  );
});
GraphSonification.displayName = "GraphSonification";
