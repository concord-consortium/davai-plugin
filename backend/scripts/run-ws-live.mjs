// Boot the REAL agent server (loads backend/.env, needs OPENAI_API_KEY) on a free
// port and run the live WS end-to-end check. Skips gracefully if no key is present.
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
const hasKey =
  process.env.OPENAI_API_KEY ||
  (fs.existsSync(envFile) && /^OPENAI_API_KEY=.+/m.test(fs.readFileSync(envFile, "utf8")));
if (!hasKey) {
  console.log("SKIP ws:live — no OPENAI_API_KEY in env or backend/.env");
  process.exit(0);
}

const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on("error", rej);
  });
const waitPing = (port) =>
  new Promise((res, rej) => {
    let n = 0;
    const tick = () => {
      const c = net.connect(port, "127.0.0.1");
      c.on("connect", () => { c.destroy(); res(); });
      c.on("error", () => { c.destroy(); if (++n > 40) rej(new Error("no start")); else setTimeout(tick, 100); });
    };
    tick();
  });

const port = await freePort();
const server = spawn("node", ["dist/server.cjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "inherit" });
let code = 1;
try {
  await waitPing(port);
  code = await new Promise((resolve) => {
    const t = spawn("node", ["test/ws-live.mjs"], { cwd: root, env: { ...process.env, WS_PORT: String(port) }, stdio: "inherit" });
    t.on("exit", (c) => resolve(c ?? 1));
  });
} finally {
  server.kill();
}
process.exit(code);
