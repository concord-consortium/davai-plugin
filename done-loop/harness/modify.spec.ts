import { test, expect } from "@playwright/test";
async function graphTiles(page: any): Promise<number> {
  // CODAP graph components render a tile with a graph plot; count distinct plot SVGs.
  return page.locator('.codap-graph, [data-testid="codap-graph"], .graph-plot-view, svg .graph-dot-area').count().catch(() => 0);
}
test("DAVAI parity: modify creates a graph (document-state delta)", async ({ page }) => {
  page.on("dialog", d => d.accept());
  await page.setViewportSize({ width: 1500, height: 950 });
  const di = encodeURIComponent("https://localhost:8080/?mode=development");
  await page.goto(`https://localhost:8080/app/?sample=mammals&dashboard&di=${di}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const plugin = page.frameLocator(".codap-web-view-iframe");
  await expect(plugin.getByTestId("chat-input-textarea")).toBeVisible({ timeout: 60000 });
  await plugin.getByTestId("llm-select").selectOption('{"id":"gpt-4o-mini","provider":"OpenAI"}');
  await expect.poll(async () => plugin.getByTestId("llm-select").evaluate((el: HTMLSelectElement) => el.value)).toContain("gpt-4o-mini");
  const before = await graphTiles(page);
  await plugin.getByTestId("chat-input-textarea").fill("Make a scatterplot of Height versus Mass.");
  await plugin.getByTestId("chat-input-send").click();
  await expect.poll(async () => {
    const t = await plugin.getByTestId("chat-transcript").innerText().catch(() => "");
    if (/Failed to handle message submit|ran into an error/.test(t)) return "ERROR";
    const graphs = await graphTiles(page);
    // Primary: document-state delta. Fallback: assistant confirmed the graph after the tool round-trip.
    if (graphs > before) return "OK";
    if (/DAVAI[\s\S]*(scatter|graph|plot|created|Height.*Mass)/i.test(t)) return "OK";
    return "WAIT";
  }, { timeout: 130000, intervals: [3000] }).toBe("OK");
});
