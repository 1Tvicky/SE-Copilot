import { defineConfig, devices } from "@playwright/test";

/**
 * Requires the full stack running against a disposable test database:
 *   a Postgres database (local install or `docker compose up postgres -d`)
 *   DATABASE_URL=... npm run db:migrate --workspace=packages/db
 *   npm run db:seed --workspace=packages/db
 *   npm run dev:web   (and npm run dev:worker for the background pipeline)
 * Not run in CI/sandboxes without that setup — see README "Testing".
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
