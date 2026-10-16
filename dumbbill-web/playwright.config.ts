import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests: open the real app in Chromium, check both colour themes, accessibility (axe),
 * security headers and the main interactions.
 *
 * `pnpm test:e2e` builds and starts the app itself on port 3100 (or reuses one already running there).
 * The build reads .env.production; for a local run copy .env.production.example and point it at localhost.
 * First time only: `pnpm exec playwright install chromium` downloads the test browser.
 * The API does not need to be running; the pages show an honest "cannot reach the server" state.
 */
const PORT = 3100;

/**
 * By default the tests run against the PRODUCTION build (`next build` then `next start`): that is what
 * actually ships, and it is the only mode where the strict Content-Security-Policy can be judged fairly.
 * Set E2E_DEV=1 to use the faster dev server while writing tests (dev adds noise of its own).
 */
const useDevServer = process.env.E2E_DEV === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: useDevServer
      ? `pnpm exec next dev -p ${PORT}`
      : `pnpm build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // The gallery page is part of what the tests check, so it is switched on for the test build.
    env: { NEXT_PUBLIC_DESIGN_GALLERY: 'true' },
    reuseExistingServer: true,
    timeout: 300_000, // a production build takes a while the first time
  },
});
