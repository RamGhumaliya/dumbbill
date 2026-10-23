import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/mock-api';

/**
 * The design system, tested as a user (or an assistive technology) would meet it, on the live gallery at /design:
 *   - both themes are accessible, including with a dialog, a menu and a popover OPEN
 *   - every interactive component works with the keyboard alone
 *   - motion is switched off for people who ask for it
 *   - fonts and styles come from our own server (nothing from Google or any other site)
 *
 * The gallery only exists in builds made with NEXT_PUBLIC_DESIGN_GALLERY=true; the test build sets it.
 */
const THEMES = ['dark', 'light'] as const;

async function open(page: Page, theme?: (typeof THEMES)[number]) {
  if (theme) {
    await page
      .context()
      .addCookies([{ name: 'dumbbill-theme', value: theme, url: 'http://localhost:3100' }]);
  }
  await page.goto('/design');
  await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();
}

/** Serious or critical accessibility problems currently on the page, as readable text. */
async function seriousProblems(page: Page, skipRules: string[] = []): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(skipRules)
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} -> ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
}

test.describe('themes and accessibility', () => {
  for (const theme of THEMES) {
    test(`the whole gallery is accessible in the ${theme} theme`, async ({ page }) => {
      await open(page, theme);
      expect(await seriousProblems(page)).toEqual([]);
    });

    test(`the gallery looks right in the ${theme} theme (screenshots for review)`, async ({
      page,
    }) => {
      await open(page, theme);
      await page.screenshot({ path: `test-results/screens/gallery-${theme}.png`, fullPage: true });
      // The "squint test": blur everything. If the hierarchy (what matters most) is still clear, the layout works.
      // Set through the DOM: the strict Content-Security-Policy (correctly) refuses injected <style> tags.
      await page.evaluate(() => {
        document.body.style.filter = 'blur(5px)';
      });
      await page.screenshot({
        path: `test-results/screens/gallery-${theme}-squint.png`,
        fullPage: true,
      });
    });
  }

  test('the two themes really use different colours for the same token', async ({ page }) => {
    const colourIn = async (theme: (typeof THEMES)[number]) => {
      await page.context().clearCookies();
      await open(page, theme);
      return page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      );
    };
    expect(await colourIn('dark')).toBe('#c6f432'); // volt
    expect(await colourIn('light')).toBe('#0f5c5c'); // deep teal
  });
});

test.describe('overlays stay accessible while open', () => {
  for (const theme of THEMES) {
    test(`dialog, select and popover in the ${theme} theme`, async ({ page }) => {
      await open(page, theme);

      await page.getByRole('button', { name: 'Cancel bill' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Cancel this bill?' })).toBeVisible();
      expect(await seriousProblems(page), 'dialog open').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('combobox', { name: 'Category' }).click();
      await expect(page.getByRole('listbox')).toBeVisible();
      // Radix hides the rest of the page from screen readers while the list is open (aria-hidden). axe objects that
      // the hidden page still contains focusable elements, but they cannot be reached: Radix keeps Tab inside the
      // list, which the next lines PROVE. So only this one rule is skipped, and only for this one open state.
      expect(await seriousProblems(page, ['aria-hidden-focus']), 'select open').toEqual([]);
      for (let press = 0; press < 3; press += 1) await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('header, main'))),
        'focus escaped to the page behind',
      ).toBe(false);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Discount' }).click();
      await expect(page.getByLabel('Percentage')).toBeVisible();
      expect(await seriousProblems(page), 'popover open').toEqual([]);
    });
  }
});

test.describe('keyboard and screen-reader behaviour', () => {
  test('a button that is loading cannot be pressed and says it is busy', async ({ page }) => {
    await open(page);
    const saving = page.getByRole('button', { name: 'Saving' }).first();
    await expect(saving).toBeDisabled();
    await expect(saving).toHaveAttribute('aria-busy', 'true');
  });

  test('an icon button is named by its label', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'Close preview' }).first()).toBeVisible();
  });

  test('an invalid field is marked invalid and its error is read out with it', async ({ page }) => {
    await open(page);
    const barcode = page.getByLabel('Barcode');
    await expect(barcode).toHaveAttribute('aria-invalid', 'true');
    const message = 'This barcode is already used by Raw Whey 1 kg.';
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
    // The error text is attached to the input through aria-describedby.
    const describedBy = await barcode.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy!.split(' ').at(-1)}"]`)).toHaveText(message);
  });

  test('a required field is announced as required', async ({ page }) => {
    await open(page);
    await expect(page.getByLabel('Product name')).toHaveJSProperty('required', true);
  });

  test('select: open with the keyboard, move with arrows, choose with Enter, skip a disabled option', async ({
    page,
  }) => {
    await open(page);
    const select = page.getByRole('combobox', { name: 'Category' });
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    // Focus lands on the first option; wait for it before moving, so the keys are not lost in the opening animation.
    await expect(page.getByRole('option', { name: 'Protein and whey' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Performance' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(select).toContainText('Performance');
    await expect(page.getByRole('listbox')).toBeHidden();

    // The disabled option can never be chosen.
    await select.click();
    await expect(page.getByRole('option', { name: 'Accessories' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('checkbox: Space toggles, the label is clickable, and the dash state is announced', async ({
    page,
  }) => {
    await open(page);
    const selectAll = page.getByRole('checkbox', { name: 'Select all products' });
    await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
    await selectAll.focus();
    await page.keyboard.press('Space');
    await expect(selectAll).toBeChecked();
    await page.getByText('Select all products').click(); // clicking the label works too
    await expect(selectAll).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Allow negative stock' })).toBeDisabled();
  });

  test('tabs: arrow keys move between tabs and show the matching panel', async ({ page }) => {
    await open(page);
    const first = page.getByRole('tab', { name: 'Details' });
    await first.focus();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Stock' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('Quantity on hand in each branch.');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Price history' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('table: sort with the keyboard, the order is announced, and rows really reorder', async ({
    page,
  }) => {
    await open(page);
    const table = page.getByRole('table', { name: 'Products in this branch' });
    const stockHeader = table.getByRole('columnheader', { name: /Stock/ });
    await expect(stockHeader).toHaveAttribute('aria-sort', 'none');

    const stockValues = async () =>
      (await table.locator('tbody tr td:nth-child(4)').allTextContents()).map(Number);

    await stockHeader.getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(stockHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(await stockValues()).toEqual([0, 3, 14, 42]);

    await page.keyboard.press('Enter');
    await expect(stockHeader).toHaveAttribute('aria-sort', 'descending');
    expect(await stockValues()).toEqual([42, 14, 3, 0]);
  });

  test('table: amounts are right-aligned with Indian grouping; loading is announced; empty has a message', async ({
    page,
  }) => {
    await open(page);
    const table = page.getByRole('table', { name: 'Products in this branch' });
    await expect(table.getByRole('cell', { name: '₹4,899.00' })).toBeVisible();
    await expect(table.getByRole('cell', { name: '₹4,899.00' })).toHaveCSS('text-align', 'right');

    const loading = page.getByRole('table', { name: 'Products (loading)' });
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(1);

    await expect(page.getByRole('heading', { name: 'No products yet' })).toBeVisible();
  });

  test('dialog: opens, traps focus, closes with Escape, and gives focus back to its button', async ({
    page,
  }) => {
    await open(page);
    const trigger = page.getByRole('button', { name: 'Cancel bill' }).first();
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Cancel this bill?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/Invoice DB-0042 will be cancelled/);

    // Tab many times: focus must never leave the dialog.
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('dialog: the confirm button shows it is working and then closes the dialog', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: 'Cancel bill' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel bill' }).click();
    await expect(dialog.getByRole('button', { name: 'Cancel bill' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(dialog).toBeHidden();
  });

  test('popover: opens by button, closes with Escape and returns focus', async ({ page }) => {
    await open(page);
    const trigger = page.getByRole('button', { name: 'Discount' });
    await trigger.click();
    await expect(page.getByLabel('Percentage')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Percentage')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('toast: appears without stealing focus, can be dismissed, and goes away by itself', async ({
    page,
  }) => {
    await open(page);
    const button = page.getByRole('button', { name: 'Success toast' });
    await button.click();
    const toast = page.getByRole('region', { name: /Notifications/ }).getByText('Bill saved');
    await expect(toast).toBeVisible();
    await expect(button).toBeFocused(); // the page keeps focus: the toast is announced, not forced on the user

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast).toBeHidden();
    // Keyboard focus goes back to the button the user was on, not to the top of the page.
    await expect(button).toBeFocused();

    // Radix also keeps a hidden live region with the same words (for screen readers), so look only inside the notification area.
    const notifications = page.getByRole('region', { name: /Notifications/ });
    await page.getByRole('button', { name: 'Plain toast' }).click();
    await expect(notifications.getByText('Price updated')).toBeVisible();
    // The mouse is still where the Dismiss button was, so the new toast appeared under it, and toasts deliberately
    // pause their timer while hovered. Move the pointer away so the normal timer runs.
    await page.mouse.move(0, 0);
    await expect(notifications.getByText('Price updated')).toBeHidden({ timeout: 9000 }); // default is 5 seconds
  });

  test('money: negative amounts have a minus sign AND the danger colour, never colour alone', async ({
    page,
  }) => {
    await open(page);
    const refund = page.locator('[data-paise="-35230"]');
    await expect(refund).toHaveText('-₹352.30');
    const [refundColour, normalColour] = await Promise.all([
      refund.evaluate((node) => getComputedStyle(node).color),
      page.locator('[data-paise="12450000"]').evaluate((node) => getComputedStyle(node).color),
    ]);
    expect(refundColour).not.toBe(normalColour);
  });

  for (const theme of THEMES) {
    test(`the QR code is dark squares on a light ground in the ${theme} theme`, async ({
      page,
    }) => {
      await open(page, theme);
      const qr = page.getByRole('img', { name: 'Example QR code' });
      await expect(qr).toBeVisible();
      // Real squares, not an empty picture.
      expect((await qr.locator('path').getAttribute('d'))?.length ?? 0).toBeGreaterThan(200);
      // Scanners need the squares darker than the ground: compare the two fills as brightness.
      const [ground, squares] = await Promise.all(
        ['rect', 'path'].map((tag) =>
          qr.locator(tag).evaluate((node) => {
            const [r = 0, g = 0, b = 0] = (getComputedStyle(node).fill.match(/[\d.]+/g) ?? []).map(
              Number,
            );
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          }),
        ),
      );
      expect(ground).toBeGreaterThan(200);
      expect(squares).toBeLessThan(60);
    });
  }

  test('skeletons are hidden from screen readers', async ({ page }) => {
    await open(page);
    const skeletons = page.locator('[aria-busy="true"] > div[aria-hidden="true"]');
    await expect(skeletons.first()).toBeAttached();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('animations are effectively instant when the device asks for reduced motion', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: 'Cancel bill' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const seconds = await dialog.evaluate((node) =>
      parseFloat(getComputedStyle(node).animationDuration),
    );
    expect(seconds).toBeLessThan(0.05);
  });
});

test.describe('motion at normal settings', () => {
  test('a dialog animates with the design token duration (180 ms), not an arbitrary one', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('button', { name: 'Cancel bill' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const seconds = await dialog.evaluate((node) =>
      parseFloat(getComputedStyle(node).animationDuration),
    );
    expect(seconds).toBeCloseTo(0.18, 2);
  });
});

test.describe('self-hosted assets', () => {
  // /pos and / are behind the sign-in gate, so these tests start signed in (see support/mock-api.ts).
  test.beforeEach(async ({ page, context }) => {
    await signIn(page, context);
  });

  for (const path of ['/design', '/pos', '/']) {
    test(`${path} loads fonts and styles only from our own server`, async ({ page, baseURL }) => {
      const foreign: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        // The API (another port of our own server) is expected; anything else would be a third party.
        const own = [new URL(baseURL!).origin, 'http://localhost:3000'];
        if (url.protocol.startsWith('http') && !own.includes(url.origin))
          foreign.push(request.url());
      });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(foreign).toEqual([]);
    });
  }

  test('the self-hosted font files are really downloaded from our server and loaded', async ({
    page,
    baseURL,
  }) => {
    // next/font gives each family a generated name, so the check counts loaded faces and font downloads instead.
    const fontRequests: string[] = [];
    page.on('request', (request) => {
      if (/\.woff2(\?|$)/.test(request.url())) fontRequests.push(request.url());
    });
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    const loadedFaces = await page.evaluate(
      () => [...document.fonts].filter((face) => face.status === 'loaded').length,
    );

    // Inter Tight (latin), Barlow Condensed (latin, the weights in use), JetBrains Mono (latin) and Inter Tight
    // latin-ext, which carries the rupee sign: at least four faces must be in use on this page.
    expect(loadedFaces).toBeGreaterThanOrEqual(4);
    expect(fontRequests.length).toBeGreaterThanOrEqual(4);
    for (const url of fontRequests) expect(new URL(url).origin).toBe(new URL(baseURL!).origin);
  });
});

test.describe('alert', () => {
  test('danger and warning are announced at once (role alert); info and success politely (role status)', async ({
    page,
  }) => {
    await open(page);
    const section = page.locator('section[aria-labelledby="alerts"]');
    await expect(section.getByRole('alert')).toHaveCount(2); // warning + danger
    await expect(section.getByRole('status')).toHaveCount(2); // info + success
    await expect(section.getByRole('alert').filter({ hasText: 'Cannot sign in' })).toBeVisible();
  });

  test('the meaning is in the title text, not only in the edge colour', async ({ page }) => {
    await open(page);
    for (const title of [
      'Check your inbox',
      'Password changed',
      'Trial ends in 3 days',
      'Cannot sign in',
    ]) {
      await expect(
        page.locator('section[aria-labelledby="alerts"]').getByText(title, { exact: true }),
      ).toBeVisible();
    }
  });
});

test.describe('password input', () => {
  test('shows and hides the password with a named, keyboard-operable toggle', async ({ page }) => {
    await open(page);
    const input = page.locator('section[aria-labelledby="forms"]').getByLabel(/^Password\s*\*?$/);
    await expect(input).toHaveAttribute('type', 'password');

    const toggle = page
      .locator('section[aria-labelledby="forms"]')
      .getByRole('button', { name: 'Show password' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(input).toHaveAttribute('type', 'text');
    const hide = page
      .locator('section[aria-labelledby="forms"]')
      .getByRole('button', { name: 'Hide password' });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(input).toHaveAttribute('type', 'password');
  });

  test('the toggle has a comfortable touch size', async ({ page }) => {
    await open(page);
    const box = await page
      .locator('section[aria-labelledby="forms"]')
      .getByRole('button', { name: 'Show password' })
      .boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});
