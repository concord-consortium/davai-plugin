import * as Tone from "tone";
import { GraphSonificationModelType } from "./graph-sonification-model";
import { ITransportEventScheduler, kStepCount, TransportManager } from "./transport-manager";
import { interpolateBins, isUnivariateDotPlot, mapPitchFractionToFrequency } from "../utils/graph-sonification-utils";
import { AppConfigModelType } from "./app-config-model";

export class GraphSonificationScheduler implements ITransportEventScheduler {
  private _manager: TransportManager | undefined;

  constructor(
    private sonificationStore: GraphSonificationModelType,
    private appConfig: AppConfigModelType
  ) {
    // Try to reduce the volume to avoid clipping when multiple tones are playing
    Tone.getDestination().volume.value = -6;
  }
  scheduleTransportEvents(manager: TransportManager): (() => void) | undefined {
    this._manager = manager;

    const disposers: (() => void)[] = [];
    const addSchedulerDisposer = (disposer: (() => void) | undefined) => {
      if (disposer) {
        disposers.push(disposer);
      }
    };

    const { selectedGraph } = this.sonificationStore;
    if (!selectedGraph) return;

    const { dotPlotMode, scatterPlotEachDot, scatterPlotLSRL } = this.appConfig.sonify;
    const univariate = isUnivariateDotPlot(selectedGraph);

    if (selectedGraph.plotType === "scatterPlot") {
      if (scatterPlotEachDot) {
        addSchedulerDisposer(this.scheduleEachDot());
      }
      if (scatterPlotLSRL) {
        addSchedulerDisposer(this.scheduleScatterPlotLSRL());
      }
    } else if (univariate && dotPlotMode === "continual") {
      addSchedulerDisposer(this.scheduleUnivariateContinual());
    } else if (univariate && dotPlotMode === "each-dot") {
      addSchedulerDisposer(this.scheduleEachDot());
    }

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }

  get manager() {
    if (!this._manager) {
      throw new Error("TransportManager not set in GraphSonificationScheduler");
    }
    return this._manager;
  }

  scheduleUnivariateContinual() {
    const { binValues, primaryBounds } = this.sonificationStore;
    if (!binValues || !primaryBounds) return;

    const { bins } = binValues;
    const maxCount = Math.max(...bins) || 1;
    const interval = this.manager.duration / kStepCount;
    const smoothBinValues: number[] = interpolateBins(bins, kStepCount);

    const osc = new Tone.Oscillator(220, "sine").connect(this.manager.input);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.sync().start(0);

    const freqsToSchedule = smoothBinValues.map((count: number, i: number) => {
      const offset = i * interval;
      const countFraction = count / maxCount;
      const freq = mapPitchFractionToFrequency(countFraction);
      return { time: offset, freqValue: freq };
    });

    const part = new Tone.Part((time, value) => {
      const { freqValue } = value;
      // FIXME: The frequency is starting at 220 and then ramped to the first value
      // It should start at least at the first value, and possibly we should skip the first
      // value in this Part.
      osc.frequency.linearRampToValueAtTime(freqValue, time + interval);
    }, freqsToSchedule).start(0);

    return () => {
      part.dispose();
      osc.dispose();
    };
  }

  scheduleScatterPlotLSRL() {
    const { primaryBounds, leastSquaresLinearRegression } = this.sonificationStore;
    if (!primaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (timeLowerBound == null || timeUpperBound == null) return;

    // TODO: Default frequency?
    const osc = new Tone.Oscillator(220, "sine").connect(this.manager.input);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    // TODO: is the stop necessary here? Won't it just stop when the transport stops?
    osc.sync().start(0).stop(this.manager.duration);

    const { slope, intercept } = leastSquaresLinearRegression;
    if (slope == null || intercept == null) return;

    const interval = this.manager.duration / kStepCount;

    const freqsToSchedule: { time: number; freqValue: number; }[] = [];
    const timeRange = timeUpperBound - timeLowerBound;
    const yStart = slope * timeLowerBound + intercept;
    const yEnd = slope * timeUpperBound + intercept;
    const yLower = Math.min(yStart, yEnd);
    const yUpper = Math.max(yStart, yEnd);
    const yRange = yUpper - yLower;
    for (let i = 0; i <= kStepCount; i++) {
      const time = i * interval;
      const xValue = timeLowerBound + (i / kStepCount) * (timeRange);
      const yValue = slope * xValue + intercept;
      // It would be best to use a pitch scale that was the same for both the each dot
      // sonification and the LSRL sonification. However the range of y values might be
      // much larger for the LSRL than the individual points. For now we just
      // base it on the yValue at the extremes of the x range.
      // If the yRange is 0 the line is flat, we use a pitch fraction of 0.5.
      // This way the pitch is in the middle of the range.
      // TODO: if we have the graph axis limits we could use to get a better pitch scale.
      const pitchFraction = yRange ? (yValue - yLower) / yRange : 0.5;
      const freqValue = mapPitchFractionToFrequency(pitchFraction);
      freqsToSchedule.push({ time, freqValue });
    }

    const part = new Tone.Part((time, value) => {
      const { freqValue } = value;
      osc.frequency.linearRampToValueAtTime(freqValue, time + interval);
    }, freqsToSchedule).start(0);

    return () => {
      part.dispose();
      osc.dispose();
    };
  }

  scheduleEachDot() {
    const { primaryBounds, timeFractions, selectedGraph, pitchFractions } = this.sonificationStore;
    if (!primaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (timeLowerBound == null || timeUpperBound == null) return;

    const { pointDuration, dotPlotEachDotPitch, maxPolyphony } = this.appConfig.sonify;

    const univariate = !!selectedGraph && isUnivariateDotPlot(selectedGraph);

    const fractionGroups: Record<number, number[]> = {};
    timeFractions.forEach((frac, i) => {
      if (!fractionGroups[frac]) fractionGroups[frac] = [];
      fractionGroups[frac].push(i);
    });

    const uniqueFractions = Object.keys(fractionGroups).map(parseFloat).sort((a, b) => a - b);

    const scatterEvents = uniqueFractions.map((fraction) => {
      const offsetSeconds = fraction * this.manager.duration;
      const indices = fractionGroups[fraction];
      if (indices.length === 0) {
        throw new Error("Invalid state: time fraction group contains no data points");
      }
      let freqValues: number[] | string[];
      if (univariate) {
        // Use a constant pitch for each dot in univariate dot plot mode
        freqValues = indices.map(i => dotPlotEachDotPitch);
      } else {
        freqValues = indices.map(i => mapPitchFractionToFrequency(pitchFractions[i]));
      }
      return { time: offsetSeconds, freqValues };
    });

    const poly = new Tone.PolySynth({ maxPolyphony }).connect(this.manager.input);

    const part = new Tone.Part((time, note) => {
      poly.triggerAttackRelease(note.freqValues, pointDuration, time);
    }, scatterEvents).start(0);

    return () => {
      part.dispose();
      poly.dispose();
    };
  }


}
