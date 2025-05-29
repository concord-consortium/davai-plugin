import { useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";

export function useTone() {
  const pan = useRef<Tone.Panner | null>(null);
  const gain = useRef<Tone.Gain | null>(null);
  const osc = useRef<Tone.Oscillator | null>(null);
  const poly = useRef<Tone.PolySynth | null>(null);
  const part = useRef<Tone.Part | null>(null);

  useEffect(() => {
    // Setup audio graph
    pan.current = new Tone.Panner(0).toDestination();
    gain.current = new Tone.Gain(1).connect(pan.current);
    poly.current = new Tone.PolySynth().connect(gain.current);
    osc.current = new Tone.Oscillator(); // we don't want to initialize it with a frequency yet
    part.current = new Tone.Part(); // we don't want to initialize it with any events yet

    return () => {
      Tone.getTransport().cancel();
      gain.current?.dispose();
      osc.current?.dispose();
      pan.current?.dispose();
      part.current?.dispose();
      poly.current?.dispose();
    };
  }, []);

  const resetUnivariateSources = useCallback(() => {
    osc.current?.dispose();
    part.current?.dispose();
    osc.current =  new Tone.Oscillator();
    part.current = new Tone.Part();
  }
  , []);

  const setTransportToStart = useCallback(() => {
    Tone.getTransport().position = 0;
    Tone.getTransport().seconds = 0;
  }, []);

  const stopAndResetTransport = useCallback(() => {
    if (Tone.getTransport().state === "started") {
      Tone.getTransport().stop();
    }
    setTransportToStart();
  }, [setTransportToStart]);

  const restartTransport = useCallback(() => {
    stopAndResetTransport();
    Tone.getTransport().start();
  }, [stopAndResetTransport]);

  const cancelAndResetTransport = useCallback(() => {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    setTransportToStart();
  }, [setTransportToStart]);

  return {
    osc,
    gain,
    pan,
    poly,
    part,
    transport: Tone.getTransport(),
    resetUnivariateSources,
    setTransportToStart,
    stopAndResetTransport,
    cancelAndResetTransport,
    restartTransport
  };
}
