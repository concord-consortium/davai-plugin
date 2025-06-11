import { IDataContextChunk, chunkDataContexts } from "./data-context-utils";

describe("Data Context Utilities", () => {
  it("should not split small data contexts", () => {
    const smallContext: IDataContextChunk[] = [
      { name: "context1", context: { collections: [{ attrs: [{ name: "attr1" }] }] } },
    ];

    const chunks = chunkDataContexts(smallContext);
    expect(chunks.length).toBe(1);
  });

  it("should split large data contexts into smaller pieces", () => {
    const largeContext: IDataContextChunk[] = [{
      name: "largeContext",
      context: {
        collections: [
          {
            // Simulate a large number of attributes with large values
            attrs: Array.from({ length: 100 }, (_, i) => ({
              name: `attr${i}`,
              value: `Wh${"e".repeat(500)}!`,
            })),
          },
        ],
      },
    }];
    const chunks = chunkDataContexts(largeContext);
    expect(chunks.length).toBe(6);
  });

  it("should handle empty data contexts", () => {
    const contexts: IDataContextChunk[] = [];
    const chunks = chunkDataContexts(contexts);
    expect(chunks.length).toBe(0);
  });
});
