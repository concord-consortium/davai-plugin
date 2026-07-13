import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "modify.spec.ts", use: { ignoreHTTPSErrors: true }, timeout: 150000, reporter: "list" });
