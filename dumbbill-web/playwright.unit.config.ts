import { defineConfig } from '@playwright/test';

/**
 * Fast tests of plain logic (API client, money formatting, cart store, security policy builders).
 * They run in Node with no browser and no web server, so `pnpm test` takes a few seconds.
 * (Playwright's test runner is used for these too, so the project has a single test tool.)
 */
export default defineConfig({
  testDir: './tests/unit',
  fullyParallel: true,
  reporter: [['list']],
});
