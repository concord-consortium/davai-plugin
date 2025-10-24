import * as Tone from "tone";

export const timeStamp = (): string => {
  const now = new Date();
  return now.toLocaleString();
};

export const formatJsonMessage = (json: any) => {
  return JSON.stringify(json, null, 2);
};

const isHTMLElement = (element: Element | null): element is HTMLElement => {
  return element instanceof HTMLElement;
};

export const isInputElement = (activeElement: Element | null) => {
  if (
    activeElement &&
    (activeElement.tagName === "INPUT" ||
     activeElement.tagName === "TEXTAREA" ||
     (isHTMLElement(activeElement) && activeElement.isContentEditable))
  ) {
    return true;
  }
};

export const playSound = (note: string) => {
  const synth = new Tone.Synth().toDestination();
  synth.triggerAttackRelease(note, "8n");
};
