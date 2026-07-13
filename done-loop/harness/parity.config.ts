import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: /(davai|modify)\.spec\.ts/, use: { ignoreHTTPSErrors: true }, timeout: 150000, reporter: "line", retries: 0, workers: 1 });
