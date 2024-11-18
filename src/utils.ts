export const timeStamp = (): string => {
  const now = new Date();
  return now.toLocaleString();
};
