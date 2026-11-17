export const tokenCounter = (messages: any[]) => {
  // Simple token estimation - roughly 4 characters per token
  // Sum up the content length of all messages
  const totalLength = messages.reduce((sum, message) => {
    const content = message.content || "";
    return sum + (typeof content === "string" ? content.length : JSON.stringify(content).length);
  }, 0);
  return Math.ceil(totalLength / 4);
};

export const escapeCurlyBraces = (text: string) => {
  return text.replace(/\{/g, "{{").replace(/\}/g, "}}");
};
