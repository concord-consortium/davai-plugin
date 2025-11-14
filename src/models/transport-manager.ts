import * as Tone  from "tone";
import { action, computed, makeObservable, observable } from "mobx";

export interface ITransportEventScheduler {
  scheduleTransportEvents(manager: TransportManager): (() => void) | undefined;
}

const kDefaultDuration = 5;

// Number of intervals to divide the duration into for scheduling
export const kStepCount = 1000;

// How far ahead to schedule transport events, in seconds
const kLookAheadTime = 0.1;
// How long to delay the transport start to allow for pre-scheduling events
const kStartDelayTime = `+${kLookAheadTime}`;

// Note: that Tone.now() and Tone.getTransport().seconds add the lookAhead time
// to the returned time. See tone-js.md for more details.

// Handle tick to second precision issues with approximate comparisons
const tickTimeTolerance = 0.01; // 10 ms tolerance
function approxGreaterOrEqual(a: number, b: number): boolean {
  return a >= b - tickTimeTolerance;
}
function approxLessOrEqual(a: number, b: number): boolean {
  return a <= b + tickTimeTolerance;
}

// In Jest tests, Tone.Context is undefined
if (Tone.Context) {
  // We aren't using Tone.js for interactive sounds. It is OK if there is a slight
  // delay before the sonification of the graph starts. So we tell the AudioContext
  // this so it can improve the sound quality.
  // This is called globally so the context is setup before any Tone methods are called.
  Tone.setContext(new Tone.Context({ latencyHint : "playback" }));
}

export class TransportManager {
  pan = new Tone.Panner(-1).toDestination();
  input: Tone.InputNode = this.pan;

  speed = 1;
  state = Tone.getTransport().state;
  position = Tone.getTransport().seconds;
  looping = Tone.getTransport().loop;

  animationFrameId: number | null = null;
  panScheduleId: number | null = null;
  endPauseScheduleId: number | null = null;

  scheduledEventDisposers: (() => void)[] = [];
  transportEventScheduler: ITransportEventScheduler | null = null;

  constructor() {
    makeObservable(this, {
      speed: observable,
      state: observable,
      updateState: action,
      position: observable,
      setPosition: action,
      setSpeed: action,
      duration: computed,
      isPlaying: computed,
      isPaused: computed,
      isStopped: computed,
      looping: observable,
      setLooping: action,
    });

    // We update the position observable with an animation frame loop
    // This animation frame loop is started and stopped based on transport events
    this.stepAnimationFrame = this.stepAnimationFrame.bind(this);

    const transport = Tone.getTransport();

    // Increase the lookAhead time to help with scheduling accuracy
    Tone.getContext().lookAhead = kLookAheadTime;

    // Based on experimentation, we've verified that the transport state
    // and position properties return the updated values when used in
    // the event listeners.
    this.handleStart = this.handleStart.bind(this);
    this.handleStop = this.handleStop.bind(this);
    this.handlePause = this.handlePause.bind(this);
    transport.on("start", this.handleStart);
    transport.on("stop", this.handleStop);
    transport.on("pause", this.handlePause);

    // Set the transport loop end to match the duration, in case looping is enabled
    transport.loopEnd = this.duration;
  }

  setTransportEventScheduler(scheduler: ITransportEventScheduler) {
    this.transportEventScheduler = scheduler;
  }

  stepAnimationFrame() {
    if (this.state !== "started") {
      // If we are not playing then the position should not be updated anymore and
      // we should not schedule another animation frame.
      return;
    }
    // We use the immediate time to get the current transport time without the lookAhead.
    // See tone-js.md for more details.
    this.setPosition(Tone.getTransport().getSecondsAtTime(Tone.immediate()));
    this.animationFrameId = requestAnimationFrame(this.stepAnimationFrame);
  }

  stopAnimationFrame() {
    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  handleStart(eventTime: number) {
    this.updateState(eventTime);
    this.animationFrameId = requestAnimationFrame(this.stepAnimationFrame);
  }

  handleStop(eventTime: number) {
    this.updateState(eventTime);
    // It seems like sometimes the position isn't exactly 0 when stopped
    if (this.position !== 0) {
      console.log("TransportManager: transport stopped but position is not zero", {
        managerSeconds: this.position,
        transportSeconds: Tone.getTransport().seconds,
        transportPosition: Tone.getTransport().position,
        transportTicks: Tone.getTransport().ticks,
      });
    }
    this.stopAnimationFrame();
  }

  // Note: There is a bug in Tone.js where the underlying oscillator node can become
  // orphaned from the ToneOscillator. This results in the sound still playing after
  // the transport is paused or stopped. https://github.com/Tonejs/Tone.js/issues/1382
  // There might also be bug in this manager which causes this problem as well.
  // At least in one case hitting the reset button stopped the oscillator from playing.
  handlePause(eventTime: number) {
    this.updateState(eventTime);
    this.stopAnimationFrame();
  }

  updateState(eventTime: number) {
    this.state = Tone.getTransport().state;
    // When the state changes, we set the position based on the event time
    // The event time will be roughly `lookAhead` seconds ahead of the
    // immediate time. Since we won't be updating the position after pause
    // and stop events we need to get the position that the transport will
    // actually be at when the sounds stop.
    // In an earlier version of this code we saw cases where the position
    // will not exactly be zero when the transport is stopped. To handle that,
    // when figuring out if the transport is at the beginning we check if the position
    // with a tolerance.
    this.position = Tone.getTransport().getSecondsAtTime(eventTime);
  }

  setPosition(newPosition: number) {
    this.position = newPosition;
  }

  get duration () {
    return kDefaultDuration / this.speed;
  }

  get isPlaying() {
    return this.state === "started";
  }

  get isPaused() {
    return this.state === "paused";
  }

  get isStopped() {
    return this.state === "stopped";
  }

  get isEnded() {
    return this.isPaused && approxGreaterOrEqual(this.position, this.duration);
  }

  get isAtBeginning() {
    return (this.isPaused || this.isStopped) && approxLessOrEqual(this.position, 0);
  }

  updateSyncedPan() {
    // The latest (unreleased) version of Tone.js should support using a SyncedSignal for
    // panning so we don't have to add an events like we currently do.
    // Using a SyncedSignal works for the frequency of an oscillator, just
    // not the pan of a panner. If we want to use it, we'd add a syncedPan property:
    // in the class constructor:
    //   syncedPan = new Tone.SyncedSignal(-1, "audioRange");
    // And connect it to the panner:
    //   this.syncedPan.connect(this.pan.pan);
    // And here in updateSyncedPan method we would update it with the latest duration:
    //   this.syncedPan.cancelScheduledValues(0);
    //   this.syncedPan.setValueAtTime(-1, 0);
    //   this.syncedPan.linearRampTo(1, this.duration, 0);
    // Finally the syncedPan should be disposed along with the panner in dispose()

    if (this.panScheduleId != null) {
      Tone.getTransport().clear(this.panScheduleId);
      this.panScheduleId = null;
    }

    const interval = this.duration / kStepCount;
    this.panScheduleId = Tone.getTransport().scheduleRepeat(time => {
      // This converts the absolute time we are passed as an argument
      // to the transport seconds at that time.
      const transportSecondsAtTime = Tone.getTransport().getSecondsAtTime(time);
      const fraction = transportSecondsAtTime / this.duration;
      // convert it -1 to 1 and make sure it is clamped between -1 and 1
      const currentPan = Math.max(-1, Math.min(1, -1 + fraction * 2));

      // Schedule a linear ramp to this value at this time
      // At time zero this should basically cause the pan to immediately jump to -1
      this.pan.pan.linearRampToValueAtTime(currentPan, time);
    }, interval, 0, this.duration);
  }

  updateEndPause() {
    if (this.endPauseScheduleId != null) {
      Tone.getTransport().clear(this.endPauseScheduleId);
      this.endPauseScheduleId = null;
    }
    if (Tone.getTransport().loop) {
      // If looping is enabled, we don't need to schedule an end pause
      return;
    }
    this.endPauseScheduleId = Tone.getTransport().schedule((time) => {
      Tone.getTransport().pause(time);
    }, this.duration);
  }

  dispose() {
    this.reset();
    Tone.getTransport().off("start", this.handleStart);
    Tone.getTransport().off("stop", this.handleStop);
    Tone.getTransport().off("pause", this.handlePause);
    this.pan.dispose();
  }

  addSchedulerDisposer(disposer: (() => void) | undefined) {
    if (disposer) {
      this.scheduledEventDisposers.push(disposer);
    }
  }

  disposeSchedulers() {
    this.scheduledEventDisposers.forEach(dispose => dispose());
    this.scheduledEventDisposers = [];
  }

  /**
   * Clear any existing events and schedule all of the relevant events.
   *
   * @returns
   */
  scheduleTransportEvents() {
    // Clear any previously scheduled events, this should have done already
    // But we do it again just to be safe.
    Tone.getTransport().cancel();

    // Dispose of any objects created by the schedule functions
    this.disposeSchedulers();

    // Schedule the transport to pause at the end of the duration if necessary
    this.updateEndPause();

    // Schedule the pan ramping
    this.updateSyncedPan();

    if (this.transportEventScheduler) {
      const disposer = this.transportEventScheduler.scheduleTransportEvents(this);
      this.addSchedulerDisposer(disposer);
    }
  }

  //
  // Below are the actions that are triggered by the UI
  //

  setLooping(loop: boolean) {
    Tone.getTransport().loop = loop;
    // We keep a copy of the looping state in this manager so it can be observed
    this.looping = loop;
    // Update the end pause scheduling: either add it if we are not looping,
    // or remove it if we are looping.
    this.updateEndPause();
  }

  playPause() {
    if (this.isEnded || this.isAtBeginning) {
      // We call scheduleTransportEvents here to handle:
      // - the first time we are started
      // - when the speed is changed while it is stopped
      // - after a reset
      // If none of these things have happened, we could skip this step, but it
      // doesn't seem worth the complexity to try to track that state.
      this.scheduleTransportEvents();

      // Restart from the beginning, using the second argument of 0
      // Pass the kStartDelayTime, so the sounds start playing a little bit in the
      // future, this helps Tone.js keep its scheduling ahead of time.
      Tone.getTransport().start(kStartDelayTime, 0);
      return;
    }

    if (this.isPaused) {
      // Note: if we were paused at the end, we would have handled that above.
      // See above for why we pass kStartDelayTime.
      // Because we aren't passing a second "offset" argument, start will resume
      // from the paused position.
      Tone.getTransport().start(kStartDelayTime);
      return;
    }

    if (this.isPlaying) {
      // Pause the transport immediately instead of scheduling it in the future
      Tone.getTransport().pause(Tone.immediate());
      return;
    }

    throw new Error(`Invalid transport state: ${this.state} and time: ${this.position}`);
  }

  setSpeed(newSpeed: number) {
    const originalState = this.state;
    const originalDuration = this.duration;

    this.speed = newSpeed;

    // In all cases we need to update the transport loop end to match the new duration
    Tone.getTransport().loopEnd = this.duration;

    if (this.isStopped) {
      // We reschedule the transport events when playback starts after it has
      // been stopped, so we don't need to reschedule them here.
      // The position should be zero when stopped, so there is no need to update it.
      return;
    }

    const nowTime = Tone.now();
    let currentPosition = this.position;

    if (this.isPlaying) {
      // Stop the animation frame updates so they don't cause a flicker of the old
      // position. The animation will be restarted when the start event is received.
      this.stopAnimationFrame();

      // Pause the transport so we aren't rescheduling the events while it is playing.
      // This will trigger the updateState action, via the pauseHandler.
      // That event is delayed, it will not fire before the next line.
      // Below we restart the transport at the new position with the same nowTime
      // This appears to correctly prevent the pauseHandler from seeing the old position.
      Tone.getTransport().pause(nowTime);

      // Set the current position based on where we would have been at the old speed
      // This will be more accurate than using this.position which is only updated
      // animation frame while we are playing. And since nowTime includes the lookAhead,
      // the position updated by the animation frame will be behind what we want.
      currentPosition = Tone.getTransport().getSecondsAtTime(nowTime);
    }

    const oldFraction = currentPosition / originalDuration;
    const newPosition = oldFraction * this.duration;

    // Reschedule the tones at the new speed.
    // The Tone.js Transport has a built in way to change its speed, but our event
    // schedulers might want to change what sounds they schedule based on the speed.
    this.scheduleTransportEvents();

    if (originalState === "started") {
      // Restart playback at the new position.
      // We pass the nowTime so this start happens right after the pause above.
      // This nowTime includes the lookAhead time, so that should help the transport
      // handle all of the rescheduled events before they are supposed to sound.
      Tone.getTransport().start(nowTime, newPosition);
    } else if (originalState === "paused") {
      // If we were paused before, we start the transport at the newPosition and then
      // pause it again. This is an alternative to using:
      // Tone.getTransport().seconds = newPosition.
      // Internally, when paused, the "seconds =" approach changes the position by
      // calling setTicksAtTime. The time it uses is from its own call to `now()`.
      // This can be a little bit later than our nowTime above, so it might cause a glitch.
      Tone.getTransport().start(nowTime, newPosition);
      Tone.getTransport().pause(nowTime);
    }

    // The position will eventually get updated correctly by the start listener when we
    // restart it above. But the change to this.speed above will trigger an immediate MobX
    // reaction.
    // The autorun reaction in the GraphSonification component uses the duration which is
    // computed from the speed to update the ROI adornment. So to prevent that autorun
    // from using the old position we update it here within this same action.
    this.setPosition(newPosition);
  }

  /**
   * Clean up everything that might be related to the current sonification:
   * - stop the playback
   * - clear all scheduled events
   * - dispose any objects created by the schedulers
   * - make sure the animation frame is stopped.
   */
  reset() {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();

    this.disposeSchedulers();

    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
