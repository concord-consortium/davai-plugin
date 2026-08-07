import { test } from "@playwright/test";
import fs from "node:fs";
// Load the DEPLOYED main-branch DAVAI plugin in real CODAP, send a message, and capture the
// request it makes to the staging backend (URL + Authorization) — the old-stack baseline creds.
test("capture staging baseline endpoint + token from network", async ({ page }) => {
  page.on("dialog", d => d.accept());
  const caps: any[] = [];
  page.on("request", req => {
    const u = req.url();
    if (/davaiServer\/(message|status|tool)/.test(u)) {
      caps.push({ method: req.method(), url: u, auth: (req.headers()["authorization"] || "") });
    }
  });
  await page.setViewportSize({ width: 1500, height: 950 });
  const plugin = "https://models-resources.concord.org/davai-plugin/branch/main/?mode=development";
  await page.goto(`https://codap3.concord.org/?mouseSensor&sample=mammals&dashboard&di=${encodeURIComponent(plugin)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const frame = page.frameLocator(".codap-web-view-iframe");
  const input = frame.getByTestId("chat-input-textarea");
  await input.waitFor({ state: "visible", timeout: 60000 });
  await input.click();
  await input.fill("Hello");
  await input.press("Enter");
  await page.waitForTimeout(12000);
  const msg = caps.find(c => /davaiServer\/message/.test(c.url));
  if (msg) {
    const base = msg.url.replace(/default\/davaiServer\/message.*$/, "");
    fs.writeFileSync("/tmp/baseline-creds.json", JSON.stringify({ base, token: msg.auth }));
    console.log("BASELINE_BASE:", base);
    console.log("TOKEN_LEN:", (msg.auth || "").length, "TOKEN_PREFIX:", (msg.auth || "").slice(0, 4) + "…");
  } else {
    console.log("NO message request captured. Captured:", JSON.stringify(caps.map(c => c.url)));
  }
});
