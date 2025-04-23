import { codapInterface, IResult, getListOfDataContexts, getDataContext,  } from "@concord-consortium/codap-plugin-api";
import * as Tone from "tone";
import { ICODAPComponentListItem, ICODAPGraph } from "../types";

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

export const getUrlParam = (paramName: string) => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(paramName);
};

export const keyMap: Record<string, { shifted: string; unshifted: string }> = {
  "ShiftLeft": { shifted: "Shift", unshifted: "Shift" },
  "ShiftRight": { shifted: "Shift", unshifted: "Shift" },
  "ControlLeft": { shifted: "Ctrl", unshifted: "Ctrl" },
  "ControlRight": { shifted: "Ctrl", unshifted: "Ctrl" },
  "AltLeft": { shifted: "Alt", unshifted: "Alt" },
  "AltRight": { shifted: "Alt", unshifted: "Alt" },
  "MetaLeft": { shifted: "Command", unshifted: "Command" },
  "MetaRight": { shifted: "Command", unshifted: "Command" },
  "KeyA": { shifted: "A", unshifted: "a" },
  "KeyB": { shifted: "B", unshifted: "b" },
  "KeyC": { shifted: "C", unshifted: "c" },
  "KeyD": { shifted: "D", unshifted: "d" },
  "KeyE": { shifted: "E", unshifted: "e" },
  "KeyF": { shifted: "F", unshifted: "f" },
  "KeyG": { shifted: "G", unshifted: "g" },
  "KeyH": { shifted: "H", unshifted: "h" },
  "KeyI": { shifted: "I", unshifted: "i" },
  "KeyJ": { shifted: "J", unshifted: "j" },
  "KeyK": { shifted: "K", unshifted: "k" },
  "KeyL": { shifted: "L", unshifted: "l" },
  "KeyM": { shifted: "M", unshifted: "m" },
  "KeyN": { shifted: "N", unshifted: "n" },
  "KeyO": { shifted: "O", unshifted: "o" },
  "KeyP": { shifted: "P", unshifted: "p" },
  "KeyQ": { shifted: "Q", unshifted: "q" },
  "KeyR": { shifted: "R", unshifted: "r" },
  "KeyS": { shifted: "S", unshifted: "s" },
  "KeyT": { shifted: "T", unshifted: "t" },
  "KeyU": { shifted: "U", unshifted: "u" },
  "KeyV": { shifted: "V", unshifted: "v" },
  "KeyW": { shifted: "W", unshifted: "w" },
  "KeyX": { shifted: "X", unshifted: "x" },
  "KeyY": { shifted: "Y", unshifted: "y" },
  "KeyZ": { shifted: "Z", unshifted: "z" },
  "Comma": { shifted: "<", unshifted: "," },
  "Period": { shifted: ">", unshifted: "." },
  "Slash": { shifted: "?", unshifted: "/" },
  "Semicolon": { shifted: ":", unshifted: ";" },
  "Quote": { shifted: "\"", unshifted: "'" },
  "BracketLeft": { shifted: "{", unshifted: "[" },
  "BracketRight": { shifted: "}", unshifted: "]" },
  "Backslash": { shifted: "|", unshifted: "\\" },
  "Backquote": { shifted: "~", unshifted: "`" },
  "Minus": { shifted: "_", unshifted: "-" },
  "Equal": { shifted: "+", unshifted: "=" }
};

export const isShortcutPressed = (pressedKeys: Set<string>, shortcutKeys: string): boolean => {
  const pressedKeyCodes = Array.from(pressedKeys);
  const keystrokeElements = shortcutKeys.split("+").map((key) => key.toLowerCase());

  return keystrokeElements.every((requiredKey) => {
    if (requiredKey === "ctrl") {
      return pressedKeyCodes.some((key) => keyMap[key]?.unshifted === "Ctrl");
    }
    if (requiredKey === "shift") {
      return pressedKeyCodes.some((key) => keyMap[key]?.unshifted === "Shift");
    }
    if (requiredKey === "alt") {
      return pressedKeyCodes.some((key) => keyMap[key]?.unshifted === "Alt");
    }
    if (requiredKey === "command" || requiredKey === "meta") {
      return pressedKeyCodes.some((key) => keyMap[key]?.unshifted === "Command");
    }

    return pressedKeyCodes.some((key) => {
      const keyMapping = keyMap[key];
      if (!keyMapping) return false;

      const isShiftPressed = pressedKeyCodes.some((pressedKey) => keyMap[pressedKey]?.unshifted === "Shift");
      if (isShiftPressed) {
        return keyMapping.shifted.toLowerCase() === requiredKey;
      } else {
        return keyMapping.unshifted.toLowerCase() === requiredKey;
      }
    });
  });
};

export const playSound = (note: string) => {
  const synth = new Tone.Synth().toDestination();
  synth.triggerAttackRelease(note, "8n");
};

export const convertBase64ToImage = async (base64Data: string, filename = "image.png") => {
  try {
    const mimeType = base64Data.match(/data:(.*?);base64/)?.[1] || "image/png";
    const base64 = base64Data.split(",")[1];
    const binary = atob(base64);
    const binaryLength = binary.length;
    const arrayBuffer = new Uint8Array(binaryLength);
    for (let i = 0; i < binaryLength; i++) {
      arrayBuffer[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([arrayBuffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    return file;
  } catch (error) {
    console.error("Error converting base64 to image:", error);
    throw error;
  }
};

export const getGraphComponents = async () => {
  const response = await codapInterface.sendRequest({ action: "get", resource: "componentList" }) as IResult;
  return response.values.filter((c: any) => c.type === "graph");
};

export const getGraphDetails = async () => {
  const graphs = await getGraphComponents();
  return Promise.all(graphs.map((g: ICODAPComponentListItem) =>
    codapInterface.sendRequest({ action: "get", resource: `component[${g.id}]` }) as Promise<IResult>
  )).then(results => results.map(r => r.values));
};

export const getGraphByID = async (id: string) => {
  const response = await codapInterface.sendRequest({ action: "get", resource: `component[${id}]` }) as IResult;
  return response.values;
};

export const getDataContexts = async () => {
  const contexts = await getListOfDataContexts();
  const contextsDetails: Record<string, any> = {};
  for (const ctx of contexts.values) {
    const { name } = ctx;
    const ctxDetails = await getDataContext(name);
    contextsDetails[name] = ctxDetails.values;
  }
  return contextsDetails;
};

export const sendCODAPRequest = async (request: any) => {
  const response = await codapInterface.sendRequest(request);
  return response;
};

export const getParsedData = (toolCall: any) => {
  try {
    const data = JSON.parse(toolCall.function.arguments);
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
};

export function isUnivariateDotPlot(graph: ICODAPGraph): boolean {
  const {
    plotType,
    topSplitAttributeID: topId,
    rightSplitAttributeID: rightId,
    y2AttributeID: y2Id,
    xAttributeID: xId,
    yAttributeID: yId
  } = graph;

  const isDotPlot = plotType === "dotPlot" || plotType === "binnedDotPlot";
  const hasExactlyOneAxis = (xId && !yId) || (yId && !xId);

  return !!(isDotPlot
    && !topId
    && !rightId
    && !y2Id
    && hasExactlyOneAxis);
}

export function isGraphValidType(graph: ICODAPGraph): boolean {
  return graph.plotType === "scatterPlot" || isUnivariateDotPlot(graph);
}
