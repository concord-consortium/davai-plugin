import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "capture-baseline.spec.ts", use: { ignoreHTTPSErrors: true }, timeout: 120000, reporter: "list" });
