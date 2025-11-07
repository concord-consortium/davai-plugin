// hooks/useSonificationScheduler.ts
import { useCallback } from "react";
import * as Tone from "tone";
import { interpolateBins, mapPitchFractionToFrequency, mapValueToStereoPan, isUnivariateDotPlot } from "../utils/graph-sonification-utils";
import { useAppConfigContext } from "../contexts/app-config-context";
import { GraphSonificationModelType } from "../models/graph-sonification-model";

type Props = {
  sonificationStore: GraphSonificationModelType;
  osc: React.MutableRefObject<Tone.Oscillator | null>;
  pan: React.MutableRefObject<Tone.Panner | null>;
  poly: React.MutableRefObject<Tone.PolySynth | null>;
  part: React.MutableRefObject<Tone.Part | null>;
  durationRef: React.MutableRefObject<number>;
};

export const useSonificationScheduler = ({ sonificationStore,
  osc, pan, poly, part, durationRef}: Props) => {

  const { selectedGraph, binValues, pitchFractions, timeFractions, timeValues, primaryBounds } = sonificationStore;

  const { sonify: { pointDuration, dotPlotMode, dotPlotEachDotPitch, scatterPlotEachDot, scatterPlotLSRL } } = useAppConfigContext();
  const univariate = !!selectedGraph && isUnivariateDotPlot(selectedGraph);

  const scheduleUnivariateContinual = useCallback(() => {
    if (!binValues || !primaryBounds || !pan.current) return;
    const { bins, minBinEdge, maxBinEdge, binWidth } = binValues;
    const maxCount = Math.max(...bins) || 1;
    const stepCount = 1000;
    const interval = durationRef.current / stepCount;
    const smoothBinValues: number[] = interpolateBins(bins, stepCount);

    // Dispose of any existing oscillator before creating a new one to prevent memory leaks
    if (osc.current) {
      osc.current.dispose();
      osc.current = null;
    }
    osc.current = new Tone.Oscillator(220, "sine").connect(pan.current);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.current.sync().start(0).stop(durationRef.current);

    const freqsToSchedule = smoothBinValues.map((count: number, i: number) => {
      const offset = i * interval;
      const countFraction = count / maxCount;
      const freq = mapPitchFractionToFrequency(countFraction);
      const binAvg = minBinEdge + ((i + 0.5) / stepCount) * binWidth;
      const panVal = mapValueToStereoPan(binAvg, minBinEdge, maxBinEdge);
      return { time: offset, freqValue: freq, panValue: panVal };
    });

    part.current = new Tone.Part((time, value) => {
      const { freqValue, panValue } = value;
      pan.current?.pan.linearRampToValueAtTime(panValue, time + interval);
      osc.current?.frequency.linearRampToValueAtTime(freqValue, time + interval);
    }, freqsToSchedule).start(0);
  }, [binValues, primaryBounds, durationRef, osc, pan, part]);

  const scheduleScatterPlotLSRL = useCallback(() => {
    if (!primaryBounds || !pan.current) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (!timeLowerBound || !timeUpperBound) return;


    // Dispose of any existing oscillator before creating a new one to prevent memory leaks
    if (osc.current) {
      osc.current.dispose();
      osc.current = null;
    }
    // TODO: what should the default frequency be?
    osc.current = new Tone.Oscillator(220, "sine").connect(pan.current);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.current.sync().start(0).stop(durationRef.current);

    const { slope, intercept } = sonificationStore.leastSquaresLinearRegression;
    if (slope == null || intercept == null) return;

    const stepCount = 1000;
    const interval = durationRef.current / stepCount;

    const freqsToSchedule: { time: number; freqValue: number; panValue: number }[] = [];
    const timeRange = timeUpperBound - timeLowerBound;
    const yStart = slope * timeLowerBound + intercept;
    const yEnd = slope * timeUpperBound + intercept;
    const yLower = Math.min(yStart, yEnd);
    const yUpper = Math.max(yStart, yEnd);
    const yRange = yUpper - yLower;
    for (let i = 0; i <= stepCount; i++) {
      const time = i * interval;
      const xValue = timeLowerBound + (i / stepCount) * (timeRange);
      const yValue = slope * xValue + intercept;
      // It would be best to use a pitch scale that was the same for both the each dot
      // sonification and the LSRL sonification. However the range of y values might be
      // much larger for the LSRL than the individual points. For now we just map over
      // base it on the yValue at the extremes of the x range.
      // If the yRange is 0 the line is flat, we just use a pitch fraction of 0.5.
      // This way the pitch is in the middle of the range.
      const pitchFraction = yRange ? (yValue - yLower) / yRange : 0.5;
      const freqValue = mapPitchFractionToFrequency(pitchFraction);
      const panValue = mapValueToStereoPan(xValue, timeLowerBound, timeUpperBound);
      freqsToSchedule.push({ time, freqValue, panValue });
    }

    // FIXME: This use of a single part for both the LSRL and the each-dot sonification
    // can cause problems because we aren't keeping track of both parts in order to dispose
    // them.
    part.current = new Tone.Part((time, note) => {
      const { freqValue, panValue } = note;
      pan.current?.pan.linearRampToValueAtTime(panValue, time + interval);
      osc.current?.frequency.linearRampToValueAtTime(freqValue, time + interval);
    }, freqsToSchedule).start(0);
  }, [durationRef, osc, pan, part, primaryBounds, sonificationStore.leastSquaresLinearRegression]);


  const scheduleEachDot = useCallback(() => {
    if (!primaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (!timeLowerBound || !timeUpperBound) return;

    const fractionGroups: Record<number, number[]> = {};
    timeFractions.forEach((frac, i) => {
      if (!fractionGroups[frac]) fractionGroups[frac] = [];
      fractionGroups[frac].push(i);
    });

    const uniqueFractions = Object.keys(fractionGroups).map(parseFloat).sort((a, b) => a - b);

    const scatterEvents = uniqueFractions.map((fraction) => {
      const offsetSeconds = fraction * durationRef.current;
      const indices = fractionGroups[fraction];
      if (indices.length === 0) {
        throw new Error("Invalid state: time fraction group contains no data points");
      }
      const panValue = mapValueToStereoPan(timeValues[indices[0]], timeLowerBound, timeUpperBound);
      let freqValues: number[] | string[];
      if (univariate) {
        // Use a constant pitch for each dot in univariate dot plot mode
        freqValues = indices.map(i => dotPlotEachDotPitch);
      } else {
        freqValues = indices.map(i => mapPitchFractionToFrequency(pitchFractions[i]));
      }
      return { time: offsetSeconds, panValue, freqValues };
    });

    part.current = new Tone.Part((time, note) => {
      pan.current?.pan.setValueAtTime(note.panValue, time);
      poly.current?.triggerAttackRelease(note.freqValues, pointDuration, time);
    }, scatterEvents).start(0);
  }, [primaryBounds, timeFractions, part, durationRef, timeValues, univariate, dotPlotEachDotPitch, pitchFractions, pan, poly, pointDuration]);

  const scheduleTones = useCallback(() => {
    // dispose current oscillators and parts
    osc.current?.dispose();
    part.current?.dispose();

    if (!selectedGraph) return;

    if (selectedGraph.plotType === "scatterPlot") {
      if (scatterPlotEachDot) {
        scheduleEachDot();
      }
      if (scatterPlotLSRL) {
        scheduleScatterPlotLSRL();
      }
    } else if (univariate && dotPlotMode === "continual") {
      scheduleUnivariateContinual();
    } else if (univariate && dotPlotMode === "each-dot") {
      scheduleEachDot();
    }
  }, [osc, part, selectedGraph, univariate, dotPlotMode, scatterPlotEachDot, scatterPlotLSRL, scheduleEachDot, scheduleScatterPlotLSRL, scheduleUnivariateContinual]);

  return {
    scheduleTones
  };
};
