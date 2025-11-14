import React, { useState } from "react";
import { observer } from "mobx-react-lite";
import * as Tone from "tone";
import { action, makeObservable, observable } from "mobx";

// Set a large lookAhead time for testing
// Tone.getContext().lookAhead = 2;
// const kStartDelay = "+0.5";
const kStartDelay = undefined;

// Simple logger function to avoid lint errors when console.log is disabled
function log(...args: any[]) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

class TransportManager {
  position = Tone.getTransport().seconds;
  oscillator = new Tone.Oscillator(220, "sine");
  transportState = Tone.getTransport().state;

  constructor() {
    makeObservable(this, {
      position: observable,
      transportState: observable,
      setCachedPosition: action,
      setPosition: action,
      updateTransportState: action,
    });

    // Sync the sounding and silencing of the oscillator to the start and stopping of the transport
    this.oscillator.sync();
    // Connect the oscillator to the speakers
    this.oscillator.toDestination();
    // Start playing the oscillator at time 0 of the Transport's timeline
    // Note that if the oscillator is started at a time later than 0,
    // There is a bug where the oscillator can become orphaned:
    // https://github.com/Tonejs/Tone.js/issues/1382
    this.oscillator.start();

    // Make a synced signal to control the frequency with a ramp that is based on the
    // the transport time.
    const syncedFreq = new Tone.SyncedSignal(220, "frequency");
    syncedFreq.connect(this.oscillator.frequency);
    syncedFreq.linearRampTo(880, 10, 0);

    this.handleStart = this.handleStart.bind(this);
    this.handleStop = this.handleStop.bind(this);
    this.handlePause = this.handlePause.bind(this);

    Tone.getTransport().on("start", this.handleStart);
    Tone.getTransport().on("stop", this.handleStop);
    Tone.getTransport().on("pause", this.handlePause);

    // We could save this scheduled event's ID so we can cancel it if we
    // need to adjust the end time.
    Tone.getTransport().schedule((time) => {
      Tone.getTransport().pause(time);
    }, 5);

    this.animationFrameStep = this.animationFrameStep.bind(this);

    // Here is alternative approach to updating the position
    // new Tone.Loop((time) => {
    //   Tone.getDraw().schedule(() => {
    //     if (this.transportState !== "started") {
    //       // If we are not playing then the position is not changing and
    //       // it should have been updated to the correct value already when
    //       // the transport was paused or stopped.
    //       return;
    //     }
    //     this.setCachedPosition(Tone.getTransport().getSecondsAtTime(time));
    //   }, time);
    // }, 0.1).start();
  }

  animationFrameStep() {
    if (this.transportState !== "started") {
      // If we are not playing then the position is not changing and
      // it should have been updated to the correct value already when
      // the transport was paused or stopped.
      // And we also don't want to schedule another animation frame.
      return;
    }
    this.setCachedPosition(Tone.getTransport().getSecondsAtTime(Tone.getContext().immediate()));
    requestAnimationFrame(this.animationFrameStep);
  }

  async playPause() {
    await Tone.start();

    if (Tone.getTransport().state === "started") {
      log("Pausing transport", {
        "Tone.now()": Tone.now(),
      });
      Tone.getTransport().pause(Tone.immediate());
    } else {
      log("Starting transport", {
        "Tone.now()": Tone.now(),
      });
      // Start will resume from the current position
      // If we add a large lookAhead then we also add a large start delay
      // so there is time to pre-schedule the events
      Tone.getTransport().start(kStartDelay);
      // If we tell it to auto stop like this:
      // Tone.getTransport().stop("@2");
      // It will stop at 2 seconds. When it stops it resets the position.
      // So this isn't a good approach when we have a position slider or some
      // indication of the position.
      // Tone.getTransport().pause("@5");
    }
  }

  reset() {
    Tone.getTransport().stop();
  }

  // TODO: add a event listener so we can update the position of the
  // slider while it is playing.

  setPosition(newPosition: number) {
    this.position = newPosition;
    Tone.getTransport().seconds = newPosition;
  }

  setCachedPosition(newPosition: number) {
    this.position = newPosition;
  }

  /**
   *
   * @param eventAbsoluteTime this is the time when the event should actually be applied to the
   * playing sounds. It should be very close to Tone.now() at the time the event was emitted.
   * @param startTransportTime For start events this is the transport time that the start is
   * supposed to start the sounds at.
   */
  updateTransportState(eventAbsoluteTime: number) {
    this.transportState = Tone.getTransport().state;
    this.position = Tone.getTransport().getSecondsAtTime(eventAbsoluteTime);
  }

  handleStart(eventAbsoluteTime: number, startTransportTime: number) {
    log("Start:", { eventAbsoluteTime, startTransportTime });
    this.updateTransportState(eventAbsoluteTime);
    // This might cause a jump backwards
    this.animationFrameStep();
  }

  handleStop(eventAbsoluteTime: number) {
    log("Stop:", { eventAbsoluteTime });
    this.updateTransportState(eventAbsoluteTime);
  }

  handlePause(eventAbsoluteTime: number) {
    log("Pause:", { eventAbsoluteTime });
    this.updateTransportState(eventAbsoluteTime);
  }
}

export const TransportDemo = observer(function TransportDemo() {
  const [manager] = useState(() => new TransportManager());
  log("Rendering TransportDemo", {
     "Tone.now()": Tone.now(),
     "Manager.position": manager.position,
  });

  return (
    <div>
      <h2>Transport Demo</h2>
      <button onClick={() => manager.playPause()}>Play/Pause</button>
      <button onClick={() => manager.reset()}>Reset</button>
      <button onClick={() => Tone.getTransport().cancel(1)}>Transport Cancel</button>
      <div>
        <label>
          Transport Position<br />
          <input id="transport-position" type="range" min="0" max="10" step="0.01"
            value={manager.position}
            onChange={(e) => manager.setPosition(parseFloat(e.target.value))}
          />
          <span>{manager.position.toFixed(2)}</span>
        </label>
      </div>
      {/* add toggle for looping so we can test the effect of auto stopping when the
      transport has a pause event and loopEnd */}
      <div>
        Manager.transportState: {manager.transportState}<br />
        Manager.position: {manager.position.toFixed(4)} seconds<br />
        Tone.getTransport().seconds: {Tone.getTransport().seconds.toFixed(3)}<br />
        Transport.getSecondsAtTime(Tone.now()): {Tone.getTransport().getSecondsAtTime(Tone.now()).toFixed(3)}<br />
        Transport.getSecondsAtTime(Tone.immediate()): {Tone.getTransport().getSecondsAtTime(Tone.immediate()).toFixed(3)}<br />
        Tone.now(): {Tone.now().toFixed(3)}<br />
        Tone.immediate(): {Tone.immediate().toFixed(3)}<br />
      </div>

    </div>
  );
});
