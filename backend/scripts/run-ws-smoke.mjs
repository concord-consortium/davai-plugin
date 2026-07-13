// Reproducible WS smoke: boot the built server in fake-agent mode on a free port,
// run test/ws-smoke.mjs against it, propagate the exit code, then tear down.
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const waitForPing = (port) =>
  new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      const req = net.connect(port, "127.0.0.1");
      req.on("connect", () => { req.destroy(); resolve(); });
      req.on("error", () => {
        req.destroy();
        if (++tries > 40) return reject(new Error("server did not start"));
        setTimeout(tick, 100);
      });
    };
    tick();
  });

const port = await freePort();
const server = spawn("node", ["dist/server.cjs"], {
  cwd: root,
  env: { ...process.env, DAVAI_FAKE_AGENT: "1", PORT: String(port) },
  stdio: "inherit",
});

let code = 1;
try {
  await waitForPing(port);
  code = await new Promise((resolve) => {
    const t = spawn("node", ["test/ws-smoke.mjs"], {
      cwd: root,
      env: { ...process.env, WS_PORT: String(port) },
      stdio: "inherit",
    });
    t.on("exit", (c) => resolve(c ?? 1));
  });
} finally {
  server.kill();
}
process.exit(code);
