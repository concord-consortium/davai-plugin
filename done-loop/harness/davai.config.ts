import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "davai.spec.ts",
  use: { ignoreHTTPSErrors: true },
  timeout: 120000,
  reporter: "list",
});
