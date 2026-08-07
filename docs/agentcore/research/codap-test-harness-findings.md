# CODAP plugin e2e test-harness — findings (the done-loop pattern)

_Captured during P0. Bottom line: copy `concord-consortium/codap-plugin-starter-project`'s
`playwright/` harness (lifted into `done-loop/harness/`) and adapt it to our forked client._

## The pattern to copy: `codap-plugin-starter-project`
- **Framework:** Playwright (`@playwright/test ^1.51`), `@bgotink/playwright-coverage` for iframe coverage.
  Specs in `playwright/`, config `playwright.config.ts`.
- **Loading CODAP + plugin together:** config starts the plugin's own HTTPS dev server first
  (`start:secure`, `https://localhost:8080/`, self-signed certs in `playwright/certificate/`,
  `ignoreHTTPSErrors:true`). The spec navigates to **real hosted CODAP with the plugin injected via
  `di=`:**
  ```ts
  await page.goto("https://codap3.concord.org/?mouseSensor&di=https://localhost:8080");
  const iframe = page.frameLocator(".codap-web-view-iframe");
  ```
  No proxy, no local CODAP build.
- **Driving + reading the document:** click plugin buttons (which issue DI requests), then assert
  against **CODAP's own document UI** outside the plugin iframe:
  ```ts
  await iframe.getByRole("button", { name: "Create some data" }).click();
  await expect(page.getByTestId("collection-table-grid")).toContainText("dog");
  // round-trip: edit a case in CODAP, assert the plugin received the change notice
  await page.getByTestId("collection-table-grid").getByText("dog").dblclick();
  await page.getByTestId("cell-text-editor").fill("dogs");
  await page.getByTestId("cell-text-editor").press("Enter");
  await expect(iframe.getByRole("status", { name: "Listener Notification:" }))
    .toContainText(/"animal":"dogs"/);
  ```
  Stable CODAP-internal testids to assert on: `collection-table-grid`, `cell-text-editor`.

## The scripting layer: `@concord-consortium/codap-plugin-api` (v0.1.9, published on npm)
Everything funnels through `codapInterface.sendRequest({action, resource, values})` over **iframe-phone**.
Typed helpers cover the whole document surface we need to build/read/mutate/select:
`initializePlugin`, `createDataContext`, `createDataContextFromURL`, `createNewCollection` /
`createParentCollection` / `createChildCollection`, `createNewAttribute` / `updateAttribute`,
`createItems` / `updateCases` / `updateItemByID`, `getDataContext`, `getCollectionList`, `getCaseCount`
/ `getCaseByIndex` / `getCaseBySearch` / `getCaseByFormulaSearch`, `getAllItems`, `getSelectionList` /
`selectCases` / `addCasesToSelection`, `createTable`, `addDataContextChangeListener` /
`addComponentListener`. Helpers run **inside the plugin** (need the iframe-phone channel); tests drive
plugin UI that calls them, or use CODAP's API Tester to inject raw DI.

## Fallback: CODAP v3's own Cypress DI helpers
`concord-consortium/codap` `v3/cypress/support/elements/web-view-tile.ts` exposes `getIFrame()`,
`sendAPITesterCommand(command)`, `getAPITesterResponse()`, `confirmAPITesterResponseContains(re)` —
targeting the **Data Interactive API Tester** plugin. Lets a test fire arbitrary DI JSON and assert the
response / that CODAP's UI changed. Load fixtures via `?sample=mammals&dashboard`. Use this if we want
to read/assert document state with raw DI rather than through our plugin's buttons.

## Not useful (verified)
`sampler`, `story-builder` = mount-smoke stubs (no real CODAP in e2e). `nfl-plugin`, `choosy`,
`scraper`, `codap-data-interactive-plugins` do not exist by those names; the real small-plugin monorepo
`concord-consortium/codap-data-interactives` has no browser e2e (only the API Tester).

## How we'll use it for the done-loop
- Drive the **forked DAVAI client** in real CODAP via `di=`.
- For **modify** interactions: after the assistant acts, read document state back with
  `@concord-consortium/codap-plugin-api` `get*` helpers (or the API Tester) and assert the expected
  structural delta (new graph/attribute/selection/collection).
- For **describe** interactions: capture the assistant transcript text and LLM-judge vs the old backend.
- Reuse the client's `performance.now()` timing hooks for per-turn latency; run ≥20 iterations/interaction
  against old (deployed, polling) and new (AgentCore, WS) stacks; report mean/p50/p95.
