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
