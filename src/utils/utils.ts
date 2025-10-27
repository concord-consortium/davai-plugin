import * as Tone from "tone";

export const timeStamp = (): string => {
  const now = new Date();
  return now.toLocaleString();
};

export const formatJsonMessage = (json: any) => {
  return JSON.stringify(json, null, 2);
};

export const playSound = (note: string) => {
  const synth = new Tone.Synth().toDestination();
  synth.triggerAttackRelease(note, "8n");
};
