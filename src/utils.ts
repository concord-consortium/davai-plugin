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

export const specialKeyMap: Record<string, string> = {
  "alt": "altKey",
  "command": "metaKey",
  "ctrl": "ctrlKey",
  "control": "ctrlKey",
  "option": "altKey",
  "shift": "shiftKey",
  "shft": "shiftKey",
};

export const charKeyMap: Record<string, string> = {
  "?": "/",
  "<": ",",
  ">": ".",
  "{": "[",
  "}": "]",
  ":": ";",
  "|": "\\",
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  "_": "-",
  "+": "=",
};

// export const isShortcutPressed = (event: KeyboardEvent, shortcutKeys: string): boolean => {
//   const keystrokeElements = shortcutKeys.split("+");
//   const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
//   return keystrokeElements.every((keystroke) => {
//     if (keystroke in specialKeyMap) {
//       return event[specialKeyMap[keystroke as keyof typeof specialKeyMap] as keyof KeyboardEvent];
//     } else if (keystroke in charKeyMap && isMac) {
//       const normalizedKey = keystroke.toLowerCase();
//       return event.key === charKeyMap[normalizedKey];
//     } else {
//       const normalizedKey = keystroke.toLowerCase();
//       const isShifted = keystroke !== keystroke.toLowerCase();
//       return event.key.toLowerCase() === normalizedKey && (!isShifted || event.shiftKey);
//     }
//   });
// };

export const isShortcutPressed = (event: KeyboardEvent, shortcutKeys: string): boolean => {
  const keystrokeElements = shortcutKeys.split("+");
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  return keystrokeElements.every((keystroke) => {
    if (keystroke in specialKeyMap) {
      return event[specialKeyMap[keystroke as keyof typeof specialKeyMap] as keyof KeyboardEvent];
    } else {
      const expectedKey = isMac && keystroke in charKeyMap ? charKeyMap[keystroke] : keystroke;
      const normalizedEventKey = event.key.toLowerCase();
      const isShifted = keystroke !== keystroke.toLowerCase();

      return (
        normalizedEventKey === expectedKey.toLowerCase() && (!isShifted || event.shiftKey)
      );
    }
  });
};
