import { defineConfig, devices } from "@playwright/test";

// The parity suite drives BOTH explorer implementations through the same
// harness (skills/telemetry-map/e2e/harness.ts): the legacy single-file UI at
// /v1/observability/map/legacy and the Nuxt rewrite at /v1/observability/map.
const PORT = 18_099;

export default defineConfig({
  testDir: "./e2e",
  // .pw.ts (not .spec.ts) so the repo-root `bun test` sweep skips these.
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: `TELEMETRY_MAP_PORT=${PORT} bun ../e2e/harness.ts`,
    url: `http://127.0.0.1:${PORT}/v1/observability/map/state`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
