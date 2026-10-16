import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Every screen must (1) render, (2) look right in BOTH themes and in "follow the device" mode, and
 * (3) pass the automatic accessibility check (axe) in each of them.
 *
 * Page background colours are checked against the design tokens in src/styles/tokens.css:
 *   dark  (Iron Ledger)  #0e0f11  = rgb(14, 15, 17)
 *   light (Quiet Ledger) #fbfaf8  = rgb(251, 250, 248)
 */
const ROUTES = [
  { path: '/', heading: 'Owner dashboard' },
  { path: '/pos', heading: 'Point of sale' },
  { path: '/admin', heading: 'Platform admin' },
] as const;

const THEMES = [
  { name: 'dark', background: 'rgb(14, 15, 17)' },
  { name: 'light', background: 'rgb(251, 250, 248)' },
] as const;

async function backgroundOf(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

for (const route of ROUTES) {
  test.describe(`${route.path}`, () => {
    for (const theme of THEMES) {
      test(`renders in the ${theme.name} theme`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: 'dumbbill-theme', value: theme.name, url: baseURL! }]);
        const response = await page.goto(route.path);

        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
        await expect(page.locator('main#main')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.name);
        expect(await backgroundOf(page)).toBe(theme.background);

        // Screenshots are saved for the team to look at; they are not compared automatically yet.
        await page.screenshot({
          path: `test-results/screens/${route.path === '/' ? 'owner' : route.path.slice(1)}-${theme.name}.png`,
          fullPage: true,
        });
      });

      test(`has no serious accessibility problems in the ${theme.name} theme`, async ({
        page,
        context,
        baseURL,
      }) => {
        await context.addCookies([{ name: 'dumbbill-theme', value: theme.name, url: baseURL! }]);
        await page.goto(route.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const serious = result.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        // Print what is wrong, in readable form, if anything is.
        expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`)).toEqual([]);
      });
    }
  });
}

test.describe('following the device setting (no theme chosen)', () => {
  test.describe('device is dark', () => {
    test.use({ colorScheme: 'dark' });
    test('uses the dark theme without any data-theme attribute', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
      expect(await backgroundOf(page)).toBe('rgb(14, 15, 17)');
    });
  });

  test.describe('device is light', () => {
    test.use({ colorScheme: 'light' });
    test('uses the light theme', async ({ page }) => {
      await page.goto('/');
      expect(await backgroundOf(page)).toBe('rgb(251, 250, 248)');
    });
  });

  test.describe('an explicit choice beats the device', () => {
    test.use({ colorScheme: 'dark' });
    test('light chosen on a dark device shows light', async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'dumbbill-theme', value: 'light', url: baseURL! }]);
      await page.goto('/');
      expect(await backgroundOf(page)).toBe('rgb(251, 250, 248)');
    });
  });
});

test('an unknown address shows the not-found page with a 404 status', async ({ page }) => {
  const response = await page.goto('/this-page-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
});
