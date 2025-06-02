// hooks/useSonificationScheduler.ts
import { useCallback } from "react";
import * as Tone from "tone";
import { interpolateBins, mapPitchFractionToFrequency, mapValueToStereoPan } from "../components/graph-sonification-utils";
import { isUnivariateDotPlot } from "../utils/utils";
import { ICODAPGraph } from "../types";
import { IBinModel } from "../models/bin-model";

type Props = {
  selectedGraph: ICODAPGraph | undefined;
  binValues: IBinModel | undefined;
  pitchFractions: number[];
  timeFractions: number[];
  timeValues: number[];
  primaryBounds: {
    upperBound: number | undefined;
    lowerBound: number | undefined;
  };
  osc: React.MutableRefObject<Tone.Oscillator | null>;
  pan: React.MutableRefObject<Tone.Panner | null>;
  poly: React.MutableRefObject<Tone.PolySynth | null>;
  part: React.MutableRefObject<Tone.Part | null>;
  durationRef: React.MutableRefObject<number>;
};

export const useSonificationScheduler = ({ selectedGraph, binValues, pitchFractions, timeFractions, timeValues, primaryBounds,
  osc, pan, poly, part, durationRef}: Props) => {

  const scheduleUnivariate = useCallback(() => {
    if (!binValues || !primaryBounds) return;
    const { bins, minBinEdge, maxBinEdge, binWidth } = binValues;
    const maxCount = Math.max(...bins) || 1;
    const stepCount = 1000;
    const interval = durationRef.current / stepCount;
    const smoothBinValues: number[] = interpolateBins(bins, stepCount);

    const freqsToSchedule: [number, { freqValue: number; panValue: number }][] = smoothBinValues.map((count: number, i: number) => {
      const offset = i * interval;
      const countFraction = count / maxCount;
      const freq = mapPitchFractionToFrequency(countFraction);
      const binAvg = minBinEdge + ((i + 0.5) / stepCount) * binWidth;
      const panVal = mapValueToStereoPan(binAvg, minBinEdge, maxBinEdge);
      return [offset, { freqValue: freq, panValue: panVal }];
    });

    part.current = new Tone.Part((time, value) => {
      const { freqValue, panValue } = value;
      pan.current?.pan.linearRampToValueAtTime(panValue, time + interval);
      osc.current?.frequency.linearRampToValueAtTime(freqValue, time + interval);
    }, freqsToSchedule).start(0);
  }, [binValues, primaryBounds, durationRef, osc, pan, part]);

  const scheduleScatter = useCallback(() => {
    if (!primaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (!timeLowerBound || !timeUpperBound) return;

    const fractionGroups: Record<number, number[]> = {};
    timeFractions.forEach((frac, i) => {
      if (!fractionGroups[frac]) fractionGroups[frac] = [];
      fractionGroups[frac].push(i);
    });

    const uniqueFractions = Object.keys(fractionGroups).map(parseFloat).sort((a, b) => a - b);

    const scatterEvents: [number, { voices: { freqValue: number; panValue: number }[] }][] = uniqueFractions.map((fraction) => {
      const offsetSeconds = fraction * durationRef.current;
      const indices = fractionGroups[fraction];
      const voices = indices.map(i => ({
        freqValue: mapPitchFractionToFrequency(pitchFractions[i]),
        panValue: mapValueToStereoPan(timeValues[i], timeLowerBound, timeUpperBound)
      }));
      return [offsetSeconds, { voices }];
    });

    part.current = new Tone.Part((time, note) => {
      note.voices.forEach(({ freqValue, panValue }) => {
        pan.current?.pan.setValueAtTime(panValue, time);
        poly.current?.triggerAttackRelease(freqValue, "8n", time);
      });
    }, scatterEvents).start(0);
  }, [primaryBounds, timeFractions, pitchFractions, timeValues, poly, pan, part, durationRef]);

  const scheduleTones = useCallback(() => {
    // dispose current oscillators and parts
    osc.current?.dispose();
    part.current?.dispose();

    if (!selectedGraph) return;

    if (selectedGraph.plotType === "scatterPlot") {
      scheduleScatter();
    } else if (isUnivariateDotPlot(selectedGraph) && pan.current) {
      // create a new oscillator to use for univariate sonification
      osc.current = new Tone.Oscillator(220, "sine").connect(pan.current);
      // this syncs the oscillator to the transport, so that when we call transport.start or
      // transport.stop, the oscillator will start/stop accordingly
      osc.current.sync().start(0).stop(durationRef.current);
      scheduleUnivariate();
    }
  }, [osc, part, selectedGraph, pan, scheduleScatter, durationRef, scheduleUnivariate]);

  return {
    scheduleTones
  };
};
