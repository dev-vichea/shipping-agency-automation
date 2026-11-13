import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.SHIPPING_E2E_URL ?? "http://localhost:3000",
    trace: "off",
    ...devices["Desktop Chrome"],
  },
});
