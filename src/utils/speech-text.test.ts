import { forSpeech, chunkToSpeech, TableSpeechState } from "./speech-text";

describe("forSpeech", () => {
  it("strips bold/italic markdown", () => {
    expect(forSpeech("This is **bold** and _italic_.")).toBe("This is bold and italic.");
  });
  it("voices a bullet marker as • (not the raw symbol)", () => {
    expect(forSpeech("* First item")).toBe("• First item");
    expect(forSpeech("- Second item")).toBe("• Second item");
  });
  it("preserves a numbered list marker", () => {
    expect(forSpeech("1. Numbered item")).toBe("1. Numbered item");
  });
});

describe("chunkToSpeech table linearization", () => {
  it("linearizes data rows with header labels, skipping header and separator rows", () => {
    const state: TableSpeechState = { header: null };
    expect(chunkToSpeech("| Coaster | State | Top Speed |", state)).toBe(""); // header stored
    expect(chunkToSpeech("|---|---|---|", state)).toBe("");                    // separator skipped
    expect(chunkToSpeech("| Fury 325 | NC | 95 mph |", state))
      .toBe("Coaster Fury 325, State NC, Top Speed 95 mph");
    expect(chunkToSpeech("| Titan | TX | 85 mph |", state))
      .toBe("Coaster Titan, State TX, Top Speed 85 mph");
  });

  it("resets table context when a non-table chunk follows", () => {
    const state: TableSpeechState = { header: null };
    chunkToSpeech("| A | B |", state);     // header
    chunkToSpeech("|---|---|", state);      // separator
    expect(chunkToSpeech("Here is the summary.", state)).toBe("Here is the summary.");
    expect(state.header).toBeNull();
  });

  it("passes non-table text through forSpeech", () => {
    const state: TableSpeechState = { header: null };
    expect(chunkToSpeech("* a bullet", state)).toBe("• a bullet");
  });
});
