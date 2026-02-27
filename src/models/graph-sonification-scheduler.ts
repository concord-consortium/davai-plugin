import * as Tone from "tone";
import Loess from "loess";
import { GraphSonificationModelType, ISonificationData } from "./graph-sonification-model";
import { ITransportEventScheduler, kStepCount, TransportManager } from "./transport-manager";
import { computeAdornmentCues, interpolateBins, isUnivariateDotPlot, kLowerFreqBound, mapPitchFractionToFrequency } from "../utils/graph-sonification-utils";
import { cancelAllCues, playCue } from "../utils/cue-audio-player";
import { AppConfigModelType, ScatterPlotContinuousType } from "./app-config-model";

// Small offset (in seconds) to keep events from landing exactly on the transport
// end boundary, where Tone.js can silently skip them.
const kSchedulingMargin = 0.005;

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

    const { selectedGraph, primaryBounds, sonificationPrimaryBounds } = this.sonificationStore;
    if (!selectedGraph) return;

    // Scale the transport duration so the sweep rate stays consistent regardless of
    // how much of the axis the selection covers.
    const axisLower = primaryBounds.lowerBound ?? 0;
    const axisUpper = primaryBounds.upperBound ?? 0;
    const sonLower = sonificationPrimaryBounds.lowerBound ?? 0;
    const sonUpper = sonificationPrimaryBounds.upperBound ?? 0;
    const axisRange = axisUpper - axisLower;
    const selRange = sonUpper - sonLower;
    manager.setDurationScale(axisRange > 0 && selRange > 0 ? selRange / axisRange : 1);

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

    if (univariate) {
      addSchedulerDisposer(this.scheduleAdornmentVoiceCues());
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
    const { binValues, sonificationPrimaryBounds } = this.sonificationStore;
    if (!binValues || !sonificationPrimaryBounds) return;
    const { lowerBound: sonLower, upperBound: sonUpper } = sonificationPrimaryBounds;
    if (sonLower == null || sonUpper == null) return;

    const { bins, minBinEdge, maxBinEdge, binWidth } = binValues;

    // Pad bins with zeros to cover the full sonification range.
    // The bins from BinModel only span the data range; when the sonification
    // covers a wider range (e.g., full axis when nothing is selected), we
    // prepend/append zero-count bins so leading/trailing space is silent.
    const leadingBins = binWidth > 0 ? Math.max(0, Math.round((minBinEdge - sonLower) / binWidth)) : 0;
    const trailingBins = binWidth > 0 ? Math.max(0, Math.round((sonUpper - maxBinEdge) / binWidth)) : 0;
    const paddedBins = [
      ...Array(leadingBins).fill(0),
      ...bins,
      ...Array(trailingBins).fill(0)
    ];

    const maxCount = Math.max(...paddedBins) || 1;
    const interval = this.manager.duration / kStepCount;
    const smoothBinValues: number[] = interpolateBins(paddedBins, kStepCount);

    // Gain node mutes the oscillator in empty bins so gaps are silent
    const gain = new Tone.Gain(1).connect(this.manager.input);
    const osc = new Tone.Oscillator(kLowerFreqBound, "sine").connect(gain);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.sync().start(0);

    const freqsToSchedule = smoothBinValues.map((count: number, i: number) => {
      const offset = i * interval;
      const countFraction = count / maxCount;
      const freq = mapPitchFractionToFrequency(countFraction);
      this.addFrequenciesAtTime(offset, "Univariate Continual", freq);
      return { time: offset, freqValue: freq, hasData: count > 0 };
    });

    const part = new Tone.Part((time, value) => {
      const { freqValue, hasData } = value;
      // FIXME: The frequency is starting at kLowerFreqBound and then ramped to the first value
      // It should start at least at the first value, and possibly we should skip the first
      // value in this Part.
      osc.frequency.linearRampToValueAtTime(freqValue, time + interval);
      gain.gain.linearRampToValueAtTime(hasData ? 1 : 0, time + interval);
    }, freqsToSchedule).start(0);

    return () => {
      part.dispose();
      osc.dispose();
      gain.dispose();
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
    const freqsToSchedule: { time: number, freqValue: number, gainTarget: number }[] = [];
    const yRange = yUpper - yLower;

    // This is a fence post problem. The number of intervals between the
    // x values is one less than the number of x values.
    const interval = this.manager.duration / ( numberOfPoints - 1 );

    // Compute a gain schedule so the oscillator is silent outside the data range
    // but plays continuously from the first to the last data point (no internal gaps).
    const { timeValues, sonificationPrimaryBounds } = this.sonificationStore;
    let dataStartFraction = 0;
    let dataEndFraction = 1;
    if (sonificationPrimaryBounds) {
      const { lowerBound: sonLower, upperBound: sonUpper } = sonificationPrimaryBounds;
      if (sonLower != null && sonUpper != null) {
        const sonRange = sonUpper - sonLower;
        if (sonRange > 0 && timeValues.length > 0) {
          const numericTimes = timeValues.filter((v: unknown): v is number => typeof v === "number");
          if (numericTimes.length > 0) {
            dataStartFraction = (Math.min(...numericTimes) - sonLower) / sonRange;
            dataEndFraction = (Math.max(...numericTimes) - sonLower) / sonRange;
          }
        }
      }
    }

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
    const isInDataRange = (i: number) => {
      const fraction = i / (numberOfPoints - 1);
      return fraction >= dataStartFraction && fraction <= dataEndFraction;
    };
    const initialGain = isInDataRange(0) ? 1 : 0;

    for (let i = 1; i < numberOfPoints; i++) {
      // This is the time when the ramp should start to reach the frequency
      const time = (i-1) * interval;
      const freqValue = computeFrequencyAtIndex(i);
      const gainTarget = isInDataRange(i) ? 1 : 0;
      freqsToSchedule.push({ time, freqValue, gainTarget });
    }

    // The initial frequency of the oscillator is the first computed frequency
    // Then we schedule ramps to the next frequencies.
    // Gain node mutes the oscillator in regions with no data points.
    const gain = new Tone.Gain(initialGain).connect(this.manager.input);
    const osc = new Tone.Oscillator(initialFrequency, "sine").connect(gain);
    // this syncs the oscillator to the transport, so that when we call transport.start or
    // transport.stop, the oscillator will start/stop accordingly
    osc.sync().start(0);

    // The time being passed to the callback is the time when the ramp should start.
    // We are setting up 1 ramp for each interval.
    const part = new Tone.Part((time, value) => {
      const { freqValue, gainTarget } = value;
      osc.frequency.linearRampTo(freqValue, interval, time);
      gain.gain.linearRampToValueAtTime(gainTarget, time + interval);
    }, freqsToSchedule).start(0);

    return { part, osc, gain };
  }

  scheduleScatterPlotLSRL() {
    const { sonificationPrimaryBounds, leastSquaresLinearRegression } = this.sonificationStore;
    if (!sonificationPrimaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = sonificationPrimaryBounds;
    if (timeLowerBound == null || timeUpperBound == null) return;

    const { slope, intercept } = leastSquaresLinearRegression;
    if (slope == null || intercept == null) return;

    const timeRange = timeUpperBound - timeLowerBound;
    const yStart = slope * timeLowerBound + intercept;
    const yEnd = slope * timeUpperBound + intercept;
    const yLower = Math.min(yStart, yEnd);
    const yUpper = Math.max(yStart, yEnd);

    const { part, osc, gain } = this.createContinuousOscillatorPart({
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
      gain.dispose();
    };
  }

  scheduleScatterPlotLOESS() {
    const { points } = this.sonificationStore;
    if (!points) return;

    const data = {
      x: [] as number[],
      y: [] as number[],
    };
    for (const point of points) {
      data.x.push(point.x);
      data.y.push(point.y);
    }

    // Note: the span can be customized with:
    // new Loess(data, { span: 0.3 });
    // the default is 0.75
    const model = new Loess(data);
    const grid = model.grid([250]);
    // Note: this also includes betas and weights which might be useful
    // for figuring out the error of the fit.
    const fitted = model.predict(grid).fitted;

    const yLower = Math.min(...fitted);
    const yUpper = Math.max(...fitted);

    const { part, osc, gain } = this.createContinuousOscillatorPart({
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
      gain.dispose();
    };

  }

  scheduleEachDot() {
    const { sonificationPrimaryBounds, timeFractions, selectedGraph, pitchFractions } = this.sonificationStore;
    if (!sonificationPrimaryBounds) return;
    const { lowerBound: timeLowerBound, upperBound: timeUpperBound } = sonificationPrimaryBounds;
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
      const offsetSeconds = Math.min(fraction * this.manager.duration, this.manager.duration - kSchedulingMargin);
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

  scheduleAdornmentVoiceCues(): (() => void) | undefined {
    const { selectedGraph, sonificationPrimaryBounds } = this.sonificationStore;
    if (!selectedGraph || !isUnivariateDotPlot(selectedGraph)) return;
    if (!sonificationPrimaryBounds) return;

    const { lowerBound, upperBound } = sonificationPrimaryBounds;
    if (lowerBound == null || upperBound == null) return;

    const transport = Tone.getTransport();
    let scheduledIds: number[] = [];

    const scheduleCues = () => {
      const { adornmentData } = this.sonificationStore;
      if (!adornmentData || adornmentData.length === 0) return;

      const cues = computeAdornmentCues(adornmentData, lowerBound, upperBound, this.manager.duration);
      if (cues.length === 0) return;

      for (const cue of cues) {
        this.addValuesAtTime(cue.timeOffset, `Adornment: ${cue.label}`, [cue.timeOffset]);
        const id = transport.schedule((time) => {
          Tone.getDraw().schedule(() => {
            playCue(cue.label);
          }, time);
        }, cue.timeOffset);
        scheduledIds.push(id);
      }
    };

    // Schedule initial cues
    scheduleCues();

    // On each loop restart, re-fetch adornments and reschedule cues so newly-activated adornments are handled.
    let refreshing = false;
    const handleLoop = () => {
      if (refreshing) return;
      refreshing = true;

      scheduledIds.forEach((id) => transport.clear(id));
      scheduledIds = [];

      this.sonificationStore.setAdornments().then(() => {
        scheduleCues();
      }).finally(() => {
        refreshing = false;
      });
    };
    transport.on("loop", handleLoop);

    return () => {
      scheduledIds.forEach((id) => transport.clear(id));
      transport.off("loop", handleLoop);
      cancelAllCues();
    };
  }
}
