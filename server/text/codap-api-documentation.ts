import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the markdown file and export it as a string
const codapApiDocPath = path.join(__dirname, "codap-api-documentation-edited.md");
export const codapApiDoc = fs.readFileSync(codapApiDocPath, "utf8");
