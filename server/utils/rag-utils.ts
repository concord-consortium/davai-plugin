// This is used to ensure the CODAP Plugin API documentation Markdown is properly formatted.
export const escapeCurlyBraces = (text: string): string => {
  // Escape curly braces in JSON code blocks
  text = text.replace(/```json\n([\s\S]*?)\n```/g, (match) =>
    match.replace(/{/g, "{{").replace(/}/g, "}}")
  );

  // Escape curly braces in other parts of the text
  text = text.replace(/(?<!\\){/g, "{{").replace(/(?<!\\)}/g, "}}");

  return text;
};
