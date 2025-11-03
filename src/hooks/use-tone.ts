import { useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";
import { useAppConfigContext } from "../contexts/app-config-context";

export function useTone() {
  const pan = useRef<Tone.Panner | null>(null);
  const osc = useRef<Tone.Oscillator | null>(null);
  const poly = useRef<Tone.PolySynth | null>(null);
  const part = useRef<Tone.Part | null>(null);

  const { sonify: { maxPolyphony } } = useAppConfigContext();
  useEffect(() => {
    // Setup audio graph
    pan.current = new Tone.Panner(0).toDestination();
    poly.current = new Tone.PolySynth({ maxPolyphony }).connect(pan.current);
    osc.current = new Tone.Oscillator(); // we don't want to initialize it with a frequency yet
    part.current = new Tone.Part(); // we don't want to initialize it with any events yet

    return () => {
      Tone.getTransport().cancel();
      osc.current?.dispose();
      pan.current?.dispose();
      part.current?.dispose();
      poly.current?.dispose();
    };
  }, [maxPolyphony]);

  const disposeUnivariateSources = useCallback(() => {
    osc.current?.dispose();
    part.current?.dispose();
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
    pan,
    poly,
    part,
    disposeUnivariateSources,
    setTransportToStart,
    stopAndResetTransport,
    cancelAndResetTransport,
    restartTransport
  };
}
