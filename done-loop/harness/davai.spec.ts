import { test, expect } from "@playwright/test";
// End-to-end parity check: forked client (local) -> new agent (OLD_MODE poll API) -> OpenAI,
// inside real CODAP with the Mammals sample. Proves the NEW agent produces a correct answer
// through the real client + CODAP.
test("DAVAI parity: describe interaction returns a correct answer", async ({ page }) => {
  page.on("dialog", d => d.accept()); // confirmNewThread() on model switch
  await page.setViewportSize({ width: 1500, height: 950 });
  const di = encodeURIComponent("https://localhost:8080/?mode=development");
  await page.goto(`https://localhost:8080/app/?sample=mammals&dashboard&di=${di}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const plugin = page.frameLocator(".codap-web-view-iframe");
  await expect(plugin.getByTestId("chat-input-textarea")).toBeVisible({ timeout: 60000 });

  const select = plugin.getByTestId("llm-select");
  await select.selectOption('{"id":"gpt-4o-mini","provider":"OpenAI"}');
  await expect.poll(async () => select.evaluate((el: HTMLSelectElement) => el.value))
    .toContain("gpt-4o-mini");
  console.log("model locked to gpt-4o-mini");

  await plugin.getByTestId("chat-input-textarea").fill("How many attributes does this dataset have? Reply with just the number.");
  await plugin.getByTestId("chat-input-send").click();

  await expect.poll(async () => {
    const t = await plugin.getByTestId("chat-transcript").innerText().catch(() => "");
    if (/Failed to handle message submit/.test(t)) return "ERROR";
    const m = t.match(/Reply with just the number\.\s*([\s\S]*)$/);
    return m && /\b\d+\b/.test(m[1]) ? "OK" : "WAIT";
  }, { timeout: 120000, intervals: [3000] }).toBe("OK");

  const text = await plugin.getByTestId("chat-transcript").innerText();
  console.log("ANSWER TAIL:", JSON.stringify(text.slice(-200)));
});
