import * as Tone from "tone";
import Loess from "loess";
import { GraphSonificationModelType, ISonificationData } from "./graph-sonification-model";
import { ITransportEventScheduler, kStepCount, TransportManager } from "./transport-manager";
import { interpolateBins, isUnivariateDotPlot, kLowerFreqBound, mapPitchFractionToFrequency } from "../utils/graph-sonification-utils";
import { AppConfigModelType, ScatterPlotContinuousType } from "./app-config-model";

export class GraphSonificationScheduler implements ITransportEventScheduler {
  private _manager: TransportManager | undefined;
  private sonificationData: ISonificationData | undefined;

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

    // Reset the sonification data
    this.sonificationData = {
      items: {}
    };
    this.sonificationStore.setSonificationData(this.sonificationData);

    const { dotPlotMode, scatterPlotEachDot, scatterPlotContinuous, scatterPlotContinuousType } = this.appConfig.sonify;
    const univariate = isUnivariateDotPlot(selectedGraph);

    if (selectedGraph.plotType === "scatterPlot") {
      if (scatterPlotEachDot) {
        addSchedulerDisposer(this.scheduleEachDot());
      }
      if (scatterPlotContinuous) {
        if (scatterPlotContinuousType === ScatterPlotContinuousType.LOESS) {
          addSchedulerDisposer(this.scheduleScatterPlotLOESS());
        } else if (scatterPlotContinuousType === ScatterPlotContinuousType.LSRL) {
          addSchedulerDisposer(this.scheduleScatterPlotLSRL());
        }
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

  addFrequenciesAtTime(time: number, name: string, value: number | string | number[] | string[]) {
    const valueArray = Array.isArray(value) ? value : [value];
    const frequencies = valueArray.map(f => Tone.Frequency(f).toFrequency());
    this.addValuesAtTime(time, name, frequencies);
  }

  addValuesAtTime(time: number, name: string, values: number[]) {
    if (!this.sonificationData) return;
    let item = this.sonificationData.items[time];
    if (!item) {
      item = { };
      this.sonificationData.items[time] = item;
    }
    item[name] = values;
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

    const osc = new Tone.Oscillator(kLowerFreqBound, "sine").connect(this.manager.input);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.sync().start(0);

    const freqsToSchedule = smoothBinValues.map((count: number, i: number) => {
      const offset = i * interval;
      const countFraction = count / maxCount;
      const freq = mapPitchFractionToFrequency(countFraction);
      this.addFrequenciesAtTime(offset, "Univariate Continual", freq);
      return { time: offset, freqValue: freq };
    });

    const part = new Tone.Part((time, value) => {
      const { freqValue } = value;
      // FIXME: The frequency is starting at kLowerFreqBound and then ramped to the first value
      // It should start at least at the first value, and possibly we should skip the first
      // value in this Part.
      osc.frequency.linearRampToValueAtTime(freqValue, time + interval);
    }, freqsToSchedule).start(0);

    return () => {
      part.dispose();
      osc.dispose();
    };
  }

  createContinuousOscillatorPart(
    {
      yLower,
      yUpper,
      numberOfPoints,
      label,
      yValueFunc,
    } : {
      yLower: number,
      yUpper: number,
      numberOfPoints: number,
      label: string,
      yValueFunc: (i: number) => number
    }
  ) {
    const freqsToSchedule: { time: number, freqValue: number }[] = [];
    const yRange = yUpper - yLower;

    // This is a fence post problem. The number of intervals between the
    // x values is one less than the number of x values.
    const interval = this.manager.duration / ( numberOfPoints - 1 );

    const computeFrequencyAtIndex = (i: number) => {
      const yValue = yValueFunc(i);
      // It would be best to use a pitch scale that was the same for both the each dot
      // sonification and the continuous sonification. The range of y values will be
      // different between the continuous oscillator and the individual points, so to
      // do this properly we need to complete the range of each sonification and create
      // the pitch scale from that overall range. For now we ignore this just look at
      // range of the continuous oscillator.
      // The yRange can be 0 if the line is flat. In that case we use a pitch fraction
      // of 0.5. This way the pitch is in the middle of the range.
      const pitchFraction = yRange ? (yValue - yLower) / yRange : 0.5;
      const frequency = mapPitchFractionToFrequency(pitchFraction);

      // This is the time when this frequency should be reached
      const time = i * interval;
      this.addFrequenciesAtTime(time, `${label} freq`, frequency);
      this.addValuesAtTime(time, `${label} value`, [yValue]);
      return frequency;
    };

    const initialFrequency = computeFrequencyAtIndex(0);

    for (let i = 1; i < numberOfPoints; i++) {
      // This is the time when the ramp should start to reach the frequency
      const time = (i-1) * interval;
      const freqValue = computeFrequencyAtIndex(i);
      freqsToSchedule.push({ time, freqValue });
    }

    // The initial frequency of the oscillator is the first computed frequency
    // Then we schedule ramps to the next frequencies.
    const osc = new Tone.Oscillator(initialFrequency, "sine").connect(this.manager.input);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.sync().start(0);

    // The time being passed to the callback is the time when the ramp should start.
    // We are setting up 1 ramp for each interval.
    const part = new Tone.Part((time, value) => {
      const { freqValue } = value;
      osc.frequency.linearRampTo(freqValue, interval, time);
    }, freqsToSchedule).start(0);

    return { part, osc };
  }

  scheduleScatterPlotLSRL() {
    const { primaryBounds, leastSquaresLinearRegression } = this.sonificationStore;
    if (!primaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = primaryBounds;
    if (timeLowerBound == null || timeUpperBound == null) return;

    const { slope, intercept } = leastSquaresLinearRegression;
    if (slope == null || intercept == null) return;

    const timeRange = timeUpperBound - timeLowerBound;
    const yStart = slope * timeLowerBound + intercept;
    const yEnd = slope * timeUpperBound + intercept;
    const yLower = Math.min(yStart, yEnd);
    const yUpper = Math.max(yStart, yEnd);

    const { part, osc } = this.createContinuousOscillatorPart({
      yLower, yUpper,
      numberOfPoints: kStepCount,
      label: "Scatter Plot LSRL",
      yValueFunc(i) {
        const xValue = timeLowerBound + (i / (kStepCount - 1)) * (timeRange);
        return slope * xValue + intercept;
      }
    });

    return () => {
      part.dispose();
      osc.dispose();
    };
  }

  scheduleScatterPlotLOESS() {
    console.log("Scheduling Scatter Plot LOESS sonification");
    const { points } = this.sonificationStore;
    if (!points) return;

    console.log("Number of points for LOESS:", points.length);

    const data = {
      x: [] as number[],
      y: [] as number[],
    };
    for (const point of points) {
      data.x.push(point.x);
      data.y.push(point.y);
    }

    console.log("Fitting LOESS model");

    // Note: the span can be customized with:
    // new Loess(data, { span: 0.3 });
    // the default is 0.75
    const model = new Loess(data);
    const grid = model.grid([250]);
    console.log("LOESS grid", grid);
    const fitted = model.predict(grid).fitted;
    console.log("LOESS fitted values length:", fitted.length);

    const yLower = Math.min(...fitted);
    const yUpper = Math.max(...fitted);

    const { part, osc } = this.createContinuousOscillatorPart({
      yLower, yUpper,
      numberOfPoints: fitted.length,
      label: "Scatter Plot LOESS",
      yValueFunc(i) {
        return fitted[i];
      }
    });

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

    const { pointDuration, dotPlotEachDotPitch, maxPolyphony, synthReleaseTime } = this.appConfig.sonify;

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
      // Store frequencies for debugging
      this.addFrequenciesAtTime(offsetSeconds, "Each Dot", freqValues);

      return { time: offsetSeconds, freqValues };
    });

    const poly = new Tone.PolySynth({ maxPolyphony }).connect(this.manager.input);
    poly.set({ envelope: { release: synthReleaseTime } });

    const part = new Tone.Part((time, note) => {
      poly.triggerAttackRelease(note.freqValues, pointDuration, time);
    }, scatterEvents).start(0);

    return () => {
      part.dispose();
      poly.dispose();
    };
  }


}
