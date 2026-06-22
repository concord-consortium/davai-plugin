import * as Tone from "tone";

export const timeStamp = (): string => {
  const now = new Date();
  return now.toLocaleString();
};

export const formatJsonMessage = (json: any) => {
  return JSON.stringify(json, null, 2);
};

// Format an elapsed duration in milliseconds as seconds with 2 decimal places,
// e.g. 4234 -> "4.23 s". Used for the response-time debug log entry.
export const formatElapsedTime = (ms: number): string => {
  return `${(ms / 1000).toFixed(2)} s`;
};

export const playSound = (note: string) => {
  const synth = new Tone.Synth().toDestination();
  synth.triggerAttackRelease(note, "8n");
};
