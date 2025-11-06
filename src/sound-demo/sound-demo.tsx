import { action, makeObservable, observable } from "mobx";
import { observer } from "mobx-react-lite";
import React, { useCallback, useState } from "react";
import Markdown from "react-markdown";
import * as Tone from "tone";

/**
 * Default step:
 * "1i" = 0.002604167s
 *
 * Default Synth Envelope props:
 * attack: 0.005
 * attackCurve: "linear"
 * decay: 0.1
 * decayCurve: "exponential"
 * release: 1
 * releaseCurve: "exponential"
 * sustain: 0.3
 */

enum SoundType {
  Synth = "Synth",
  MembraneSynth = "MembraneSynth",
  PolySynth = "PolySynth",
  Oscillator = "Oscillator"
}
const SoundTypeValues = Object.values(SoundType);

enum SynthCurve {
  Linear = "linear",
  Exponential = "exponential",
}
const SynthCurveValues = Object.values(SynthCurve);

class Looper {
  sound: Tone.Synth | Tone.PolySynth | Tone.Oscillator | undefined;
  loop: Tone.Loop | undefined;
  synthReleaseTime = 1;
  synthReleaseCurve = SynthCurve.Exponential;
  started = false;
  playing = false;
  loopDuration = 50; // in ticks
  noteDuration = 50; // in ticks
  soundType: SoundType = SoundType.Synth;
  note = "C4";
  noteText = "C4";
  maxPolyphony = 120;

  constructor() {
    makeObservable(this, {
      togglePlayPause: action,
      loopDuration: observable,
      setLoopDuration: action,
      noteDuration: observable,
      setNoteDuration: action,
      soundType: observable,
      setSoundType: action,
      synthReleaseTime: observable,
      setSynthReleaseTime: action,
      note: observable,
      noteText: observable,
      setNote: action,
      maxPolyphony: observable,
      setMaxPolyphony: action,
      synthReleaseCurve: observable,
      setSynthReleaseCurve: action,
    });
  }

  updateSound() {
    if (this.sound) {
      this.sound.dispose();
      this.sound = undefined;
    }
    switch (this.soundType) {
      case SoundType.Synth:
        this.sound = new Tone.Synth();
        break;
      case SoundType.MembraneSynth:
        this.sound = new Tone.MembraneSynth();
        break;
      case SoundType.PolySynth:
        this.sound = new Tone.PolySynth({ maxPolyphony: this.maxPolyphony });
        break;
      case SoundType.Oscillator:
        this.sound = new Tone.Oscillator(this.note, "sine");
        break;
    }
    this.updateSynth();
  }

  setSoundType(type: string) {
    this.soundType = type as SoundType;
    this.updateSound();
  }

  setLoopDuration(duration: number) {
    this.loopDuration = duration;
    if (this.playing && this.loop) {
      this.loop.interval = `${this.loopDuration}i`;
    }
  }

  setNoteDuration(duration: number) {
    this.noteDuration = duration;
  }

  updateSynth() {
    if (this.sound instanceof Tone.Synth || this.sound instanceof Tone.PolySynth) {
      this.sound.set({ envelope: {
        release: this.synthReleaseTime,
        releaseCurve: this.synthReleaseCurve
      } });
    }
  }

  setSynthReleaseTime(time: number) {
    this.synthReleaseTime = time;
    this.updateSynth();
  }


  setNote(note: string) {
    this.noteText = note;
    const frequency = Tone.Frequency(note).toFrequency();
    if (isNaN(frequency)) {
      console.warn("Invalid note:", note);
      return;
    }
    this.note = note;
    if (this.sound instanceof Tone.Oscillator) {
      this.sound.frequency.value = frequency;
    }
  }

  /**
   * This probably only works when PolySynth is first created.
   * So the user needs to stop playback, change max polyphony, then start playback again.
   * @param count
   */
  setMaxPolyphony(count: number) {
    this.maxPolyphony = count;
  }

  setSynthReleaseCurve(curve: string) {
    this.synthReleaseCurve = curve as SynthCurve;
    this.updateSynth();
  }

  async togglePlayPause() {
    console.log("play/pause begin");

    await Tone.start();

    if (!this.playing) {
      // Update our sounds in case parameters changed while stopped
      this.updateSound();
      const { sound } = this;
      if (!sound) {
        console.warn("No sound available");
        return;
      }
      sound.toDestination();

      this.loop = new Tone.Loop((time) => {
        if (sound instanceof Tone.Synth || sound instanceof Tone.PolySynth) {
          // As of Tone.js version 15, the poly synth release behavior just looks for a voice with
          // the given note that hasn't been released yet, and then releases it. So if we are playing
          // multiple overlapping notes that are the same frequency, tone.js might decide to release
          // one that hasn't sounded for its full duration.
          sound.triggerAttackRelease(this.note, `${this.noteDuration}i`, time);
        } else {
          sound.start(time);
          sound.stop(time + Tone.Time(`${this.noteDuration}i`).toSeconds());
        }
      }, `${this.loopDuration}i`).start(0);

      const transport = Tone.getTransport();
      transport.start();
      this.playing = true;
    } else {
      Tone.getTransport().stop();
      this.playing = false;
      this.loop?.dispose();
    }
    console.log("play/pause end");
  }
}

export const SoundDemo = observer(function SoundDemo() {
  const [looper] = useState(() => new Looper());

  const handlePlayPause = useCallback(() => {
    looper.togglePlayPause();
  }, [looper]);

  return (
    <div>
      <button onClick={handlePlayPause}>Play/Pause</button>
      <div>
        <label htmlFor="sound-type">Sound Type</label><br />
        <select id="sound-type" name="sound-type" defaultValue={SoundType.Synth}
          onChange={(e) => looper.setSoundType(e.target.value)}
        >
          {SoundTypeValues.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="loop-duration">Loop Duration (ticks)</label><br />
        <input id="loop-duration" type="range" min="1" max="200"
          value={looper.loopDuration}
          onChange={(e) => looper.setLoopDuration(parseInt(e.target.value, 10))}
        />
        <span>{looper.loopDuration}</span>
      </div>
      <div>
        <label htmlFor="note-duration">Note Duration (ticks)</label><br />
        <input id="note-duration" type="range" min="1" max="200"
          value={looper.noteDuration}
          onChange={(e) => looper.setNoteDuration(parseInt(e.target.value, 10))}
        />
        <span>{looper.noteDuration}</span>
      </div>
      <div>
        <label htmlFor="synth-release-time">Synth Release Time</label><br />
        <input id="synth-release-time" type="range" min="0" max="1" step="0.001"
          value={looper.synthReleaseTime}
          onChange={(e) => looper.setSynthReleaseTime(parseFloat(e.target.value))}
        />
        <span>
          {looper.synthReleaseTime} s
          &nbsp;~&nbsp;
          {Tone.Time(looper.synthReleaseTime).toTicks().toFixed(0)} ticks
        </span>
      </div>
      <div>
        <label htmlFor="synth-release-curve">Synth Release Curve</label><br />
        <select id="synth-release-curve" name="synth-release-curve" defaultValue={SynthCurve.Exponential}
          onChange={(e) => looper.setSynthReleaseCurve(e.target.value)}
        >
          {SynthCurveValues.map((curve) => (
            <option key={curve} value={curve}>{curve}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="max-polyphony">Max Polyphony</label><br />
        <input id="max-polyphony" type="range" min="0" max="300"
          value={looper.maxPolyphony}
          onChange={(e) => looper.setMaxPolyphony(parseInt(e.target.value, 10))}
        />
        <span>{looper.maxPolyphony}</span>
      </div>
      <div>
        <label htmlFor="note">Note</label><br />
        <input id="note" type="text"
          value={looper.noteText}
          onChange={(e) => looper.setNote(e.target.value)}
        />
      </div>
      <Markdown>
      {`
        ## Notes

        The Tone.js [Envelope example](https://tonejs.github.io/examples/envelope) defines
        what the attack, decay, sustain, and release parameters do.

        The Tone.js [Simple Synth example](https://tonejs.github.io/examples/simpleSynth)
        includes a graph to visualize how the release time and curve affects the sound.
        Expand the "Synth" section, and expand the "Envelope" subsection to see it.

        The step time is roughly: ${Tone.Time("1i").toSeconds().toFixed(4)}s (1 tick).

        The default Synth Envelope properties are:

        - attack: 0.005 s
        - attackCurve: "linear"
        - decay: 0.1 s
        - decayCurve: "exponential"
        - release: 1 s
        - releaseCurve: "exponential"
        - sustain: 0.3 (30% of max amplitude)
      `.replace(/^[ ]+/gm, "")}
      </Markdown>
    </div>
  );
});
