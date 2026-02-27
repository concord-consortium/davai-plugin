import { replaceVoiceCommands, applyPunctuationHeuristics } from "./voice-punctuation-utils";

describe("replaceVoiceCommands", () => {
  it("replaces 'period' at end of chunk with .", () => {
    expect(replaceVoiceCommands("hello period")).toBe("hello.");
  });

  it("does not replace 'period' mid-sentence", () => {
    expect(replaceVoiceCommands("the period of time")).toBe("the period of time");
  });

  it("replaces 'comma' with ,", () => {
    expect(replaceVoiceCommands("hello comma world")).toBe("hello, world");
  });

  it("replaces 'question mark' with ?", () => {
    expect(replaceVoiceCommands("how are you question mark")).toBe("how are you?");
  });

  it("replaces 'exclamation point' with !", () => {
    expect(replaceVoiceCommands("wow exclamation point")).toBe("wow!");
  });

  it("replaces 'semicolon' with ;", () => {
    expect(replaceVoiceCommands("first semicolon second")).toBe("first; second");
  });

  it("replaces 'colon' with :", () => {
    expect(replaceVoiceCommands("note colon important")).toBe("note: important");
  });

  it("replaces 'hyphen' or 'dash' with -", () => {
    expect(replaceVoiceCommands("well hyphen known")).toBe("well-known");
    expect(replaceVoiceCommands("well dash known")).toBe("well-known");
  });

  it("replaces 'ellipsis' or 'ellipses' with ...", () => {
    expect(replaceVoiceCommands("wait ellipsis")).toBe("wait...");
    expect(replaceVoiceCommands("wait ellipses")).toBe("wait...");
  });

  it("replaces apostrophe commands with '", () => {
    expect(replaceVoiceCommands("don apostrophe t")).toBe("don't");
    expect(replaceVoiceCommands("it single quote s")).toBe("it's");
  });

  it("replaces quotation mark commands with \"", () => {
    expect(replaceVoiceCommands("he said quote hello quote")).toBe('he said "hello"');
    expect(replaceVoiceCommands("start quote hi end quote")).toBe('"hi"');
  });

  it("replaces 'new line' with newline character", () => {
    expect(replaceVoiceCommands("first line new line second line")).toBe("first line\nsecond line");
  });

  it("replaces 'newline' with newline character", () => {
    expect(replaceVoiceCommands("first newline second")).toBe("first\nsecond");
  });

  it("replaces 'new paragraph' with double newline", () => {
    expect(replaceVoiceCommands("first new paragraph second")).toBe("first\n\nsecond");
  });

  it("replaces 'smiley face' with emoji", () => {
    expect(replaceVoiceCommands("hello smiley face")).toBe("hello 😃");
  });

  it("is case-insensitive", () => {
    expect(replaceVoiceCommands("hello Period")).toBe("hello.");
    expect(replaceVoiceCommands("hello COMMA world")).toBe("hello, world");
    expect(replaceVoiceCommands("ok Question Mark")).toBe("ok?");
  });

  it("handles multiple commands in one chunk", () => {
    expect(replaceVoiceCommands("hello comma world period")).toBe("hello, world.");
  });

  it("normalizes multiple spaces", () => {
    expect(replaceVoiceCommands("hello   comma   world")).toBe("hello, world");
  });

  it("trims whitespace around newlines", () => {
    expect(replaceVoiceCommands("hello   new line   world")).toBe("hello\nworld");
  });

  it("passes through text with no commands unchanged", () => {
    expect(replaceVoiceCommands("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(replaceVoiceCommands("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(replaceVoiceCommands("   ")).toBe(" ");
  });

  it("preserves leading space from speech API chunks", () => {
    expect(replaceVoiceCommands(" hello world")).toBe(" hello world");
    expect(replaceVoiceCommands(" hello comma world")).toBe(" hello, world");
  });
});

describe("applyPunctuationHeuristics", () => {
  it("capitalizes the first character", () => {
    expect(applyPunctuationHeuristics("hello world")).toBe("Hello world");
  });

  it("capitalizes after period", () => {
    expect(applyPunctuationHeuristics("hello. world")).toBe("Hello. World");
  });

  it("capitalizes after question mark", () => {
    expect(applyPunctuationHeuristics("how? good")).toBe("How? Good");
  });

  it("capitalizes after exclamation point", () => {
    expect(applyPunctuationHeuristics("wow! great")).toBe("Wow! Great");
  });

  it("handles multiple sentences", () => {
    expect(applyPunctuationHeuristics("first. second. third")).toBe("First. Second. Third");
  });

  it("normalizes multiple spaces", () => {
    expect(applyPunctuationHeuristics("hello   world")).toBe("Hello world");
  });

  it("preserves already-capitalized text", () => {
    expect(applyPunctuationHeuristics("Hello World")).toBe("Hello World");
  });

  it("inserts space and capitalizes when sentence-ending punctuation is adjacent to next word", () => {
    expect(applyPunctuationHeuristics("hello?what")).toBe("Hello? What");
    expect(applyPunctuationHeuristics("hello.world")).toBe("Hello. World");
    expect(applyPunctuationHeuristics("wow!great")).toBe("Wow! Great");
  });

  it("inserts space after comma when directly adjacent to next word", () => {
    expect(applyPunctuationHeuristics("get,a new")).toBe("Get, a new");
  });

  it("handles empty string", () => {
    expect(applyPunctuationHeuristics("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(applyPunctuationHeuristics("   ")).toBe("");
  });
});

describe("replaceVoiceCommands + applyPunctuationHeuristics together", () => {
  const process = (text: string) => applyPunctuationHeuristics(replaceVoiceCommands(text));

  it("full pipeline: voice commands produce capitalized sentences", () => {
    expect(process("hello comma how are you question mark")).toBe("Hello, how are you?");
  });

  it("full pipeline: multiple sentences", () => {
    const chunk1 = replaceVoiceCommands("first sentence period");
    const chunk2 = replaceVoiceCommands("second sentence period");
    const combined = applyPunctuationHeuristics(`${chunk1} ${chunk2}`);
    expect(combined).toBe("First sentence. Second sentence.");
  });

  it("full pipeline: exclamation followed by new sentence", () => {
    expect(process("wow exclamation point that is great period")).toBe("Wow! That is great.");
  });

  it("full pipeline: chunks with leading spaces concatenated (real speech API behavior)", () => {
    // Speech API returns chunks with leading spaces. replaceVoiceCommands preserves them
    // so chunks naturally have spacing when concatenated with +=.
    const chunk1 = replaceVoiceCommands(" hello why aren't you working question mark");
    const chunk2 = replaceVoiceCommands(" what can we do today question mark");
    const chunk3 = replaceVoiceCommands(" what the heck period");
    const combined = applyPunctuationHeuristics(`${chunk1}${chunk2}${chunk3}`);
    expect(combined).toBe("Hello why aren't you working? What can we do today? What the heck.");
  });

  it("full pipeline: comma followed by next chunk preserves spacing", () => {
    const chunk1 = replaceVoiceCommands(" where can I get comma");
    const chunk2 = replaceVoiceCommands(" a new one");
    const combined = applyPunctuationHeuristics(`${chunk1}${chunk2}`);
    expect(combined).toBe("Where can I get, a new one");
  });
});
