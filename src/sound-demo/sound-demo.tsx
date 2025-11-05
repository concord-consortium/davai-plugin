import { action, makeObservable, observable } from "mobx";
import { observer } from "mobx-react-lite";
import React, { useCallback, useState } from "react";
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
export const SoundTypeValues = Object.values(SoundType);

class Looper {
  sound: Tone.Synth | Tone.PolySynth | Tone.Oscillator | undefined;
  loop: Tone.Loop | undefined;
  synthReleaseTime = 1;
  started = false;
  playing = false;
  loopDuration = 50; // in ticks
  noteDuration = 50; // in ticks
  soundType: SoundType = SoundType.Synth;
  note = "C4";
  noteText = "C4";

  constructor() {
    // this.sound = new Tone.Synth();
    // this.sound = new Tone.MembraneSynth();
    // this.sound = new Tone.PolySynth({ maxPolyphony: 4 });
    // this.sound = new Tone.Oscillator(220, "sine");
    this.updateSound();

    // this.synthReleaseTime = 0.02;
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
      setNote: action
    });
  }

  updateSound() {
    if (this.sound) {
      this.sound?.dispose();
    }
    switch (this.soundType) {
      case SoundType.Synth:
        this.sound = new Tone.Synth();
        break;
      case SoundType.MembraneSynth:
        this.sound = new Tone.MembraneSynth();
        break;
      case SoundType.PolySynth:
        this.sound = new Tone.PolySynth({ maxPolyphony: 4 });
        break;
      case SoundType.Oscillator:
        this.sound = new Tone.Oscillator(this.note, "sine");
        break;
    }
    this.updateSynthReleaseTime();
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

  updateSynthReleaseTime() {
    if (this.sound instanceof Tone.Synth || this.sound instanceof Tone.PolySynth) {
      console.log("updateSynthReleaseTime", this.synthReleaseTime);
      this.sound.set({ envelope: { release: this.synthReleaseTime } });
    }
  }

  setSynthReleaseTime(time: number) {
    this.synthReleaseTime = time;
    this.updateSynthReleaseTime();
  }


  setNote(note: string) {
    this.noteText = note;
    const frequency = Tone.Frequency(note).toFrequency();
    if (isNaN(frequency)) {
      console.warn("Invalid note:", note);
      return;
    }
    console.log("setNote", note, frequency);
    this.note = note;
    if (this.sound instanceof Tone.Oscillator) {
      this.sound.frequency.value = frequency;
    }
  }

  async togglePlayPause() {
    const { sound, playing, loopDuration } = this;
    console.log("click start");
    if (!sound) {
      console.warn("No sound available");
      return;
    }

    await Tone.start();

    if (!playing) {
      sound.toDestination();

      this.loop = new Tone.Loop((time) => {
        if (sound instanceof Tone.Synth || sound instanceof Tone.PolySynth) {
          sound.triggerAttackRelease(this.note, `${this.noteDuration}i`, time);
        } else {
          sound.start(time);
          sound.stop(time + Tone.Time(`${this.noteDuration}i`).toSeconds());
        }
      }, `${loopDuration}i`).start(0);

      const transport = Tone.getTransport();
      transport.start();
      this.playing = true;
    } else {
      Tone.getTransport().stop();
      this.playing = false;
      this.loop?.dispose();
    }
    console.log("click end");
  }
}

export const SoundDemo = observer(function SoundDemo() {
  const [looper] = useState(() => new Looper());

  const handlePlayPause = useCallback(() => {
    looper.togglePlayPause();
  }, [looper]);

  return (
    <div>
      <button onClick={handlePlayPause}>Play/Pause</button><br />
      <div>
        <label htmlFor="sound-type">Sound Type</label><br />
        <select id="sound-type" name="sound-type" defaultValue="Synth"
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
        <label htmlFor="synth-release-time">Synth Release Time (seconds)</label><br />
        <input id="synth-release-time" type="range" min="0" max="1" step="0.001"
          value={looper.synthReleaseTime}
          onChange={(e) => looper.setSynthReleaseTime(parseFloat(e.target.value))}
        />
        <span>{looper.synthReleaseTime}</span>
      </div>
      <div>
        <label htmlFor="note">Note</label><br />
        <input id="note" type="text"
          value={looper.noteText}
          onChange={(e) => looper.setNote(e.target.value)}
        />
      </div>
    </div>
  );
});
