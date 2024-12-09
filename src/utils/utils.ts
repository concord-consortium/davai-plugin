export const timeStamp = (): string => {
  const now = new Date();
  return now.toLocaleString();
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
