import { defineConfig, devices } from "@playwright/test";

// E2E suite runs against the LIVE deployment by default so it proves what
// users actually get. Point WR_BASE_URL at a preview/local URL to test that.
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/test-results",
  timeout: 45_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.WR_BASE_URL || "https://wealthrank-ai.vercel.app",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium" } },
  ],
});
