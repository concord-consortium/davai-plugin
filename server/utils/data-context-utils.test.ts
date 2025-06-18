import { ICodapDataChunk, chunkData } from "./data-context-utils";

describe("Data Context Utilities", () => {
  it("should not split small data objects", () => {
    const context = { collections: [{ attrs: [{ name: "attr1" }] }] }
    const smallContext: ICodapDataChunk[] = [
      { name: "context1", data: JSON.stringify(context) },
    ];

    const chunks = chunkData(smallContext);
    expect(chunks.length).toBe(1);
  });

  it("should split large data contexts into smaller pieces", () => {

    const context = {
        collections: [
          {
            // Simulate a large number of attributes with large values
            attrs: Array.from({ length: 100 }, (_, i) => ({
              name: `attr${i}`,
              value: `Wh${"e".repeat(500)}!`,
            })),
          },
        ],
      };

    const largeContext: ICodapDataChunk[] = [{
      name: "largeContext",
      data: JSON.stringify(context),
    }];
    const chunks = chunkData(largeContext);
    expect(chunks.length).toBe(5);
  });

  it("should handle empty data contexts", () => {
    const contexts: ICodapDataChunk[] = [];
    const chunks = chunkData(contexts);
    expect(chunks.length).toBe(0);
  });
});
