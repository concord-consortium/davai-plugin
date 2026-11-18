import fs from "node:fs";
import path from "node:path";

// backend/src/agent/text/ is a copy of sam-server/src/text/, and both servers send this
// text to the LLM. Nothing else notices when one copy gets a prompt fix and the other
// doesn't, so fail when they differ. Delete this test along with sam-server/.
const backendDir = __dirname;
const samServerDir = path.resolve(__dirname, "../../../../sam-server/src/text");

const textFiles = (dir: string) =>
  fs.readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();

describe("prompt text matches sam-server", () => {
  it("has the same files", () => {
    expect(textFiles(backendDir)).toEqual(textFiles(samServerDir));
  });

  it.each(textFiles(samServerDir))("%s is identical", (name) => {
    const backendText = fs.readFileSync(path.join(backendDir, name), "utf8");
    const samServerText = fs.readFileSync(path.join(samServerDir, name), "utf8");
    expect(backendText).toBe(samServerText);
  });
});
