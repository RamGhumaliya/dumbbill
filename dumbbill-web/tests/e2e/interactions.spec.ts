import { expect, test } from '@playwright/test';
import { signIn } from './support/mock-api';

/** The screens tested here sit behind the sign-in gate, so every test starts signed in (see support/mock-api.ts). */
test.beforeEach(async ({ page, context }) => {
  await signIn(page, context);
});

test.describe('theme switch', () => {
  test('choosing Dark and Light changes the page at once and is remembered after a reload', async ({
    page,
  }) => {
    await page.goto('/');
    const group = page.getByRole('group', { name: 'Colour theme' });

    await group.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // the SERVER rendered it from the cookie
    await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await group.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('System goes back to following the device', async ({ page }) => {
    await page.goto('/');
    const group = page.getByRole('group', { name: 'Colour theme' });
    await group.getByRole('button', { name: 'Dark' }).click();
    await group.getByRole('button', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('owner dashboard', () => {
  test('shows the server status honestly, whether or not the API is running', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText(
      /Server is ready|Cannot reach the server|The server answered with a problem/,
    );
  });

  test('labels the dashboard preview as sample data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Sample figures for layout only. Not real data.')).toBeVisible();
    await expect(page.getByText('₹1,84,260')).toBeVisible(); // Indian digit grouping
  });
});

test.describe('point of sale', () => {
  test('builds a bill: add, change quantity, see the preview total, remove, clear', async ({
    page,
  }) => {
    await page.goto('/pos');
    await expect(page.getByText('Nothing in the bill yet.')).toBeVisible();

    await page.getByRole('button', { name: /Add Gold Standard Whey/ }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('cell', { name: '₹4,899.00' }).first()).toBeVisible();

    await page.getByRole('button', { name: /One more Gold Standard Whey/ }).click();
    await expect(page.getByLabel(/Bill/).getByText('₹9,798').first()).toBeVisible();

    await page.getByRole('button', { name: /Add Gym Shaker/ }).click();
    await expect(page.getByRole('row')).toHaveCount(3); // header + two items

    await page.getByRole('button', { name: /Remove Gym Shaker/ }).click();
    await expect(page.getByRole('row')).toHaveCount(2);

    await page.getByRole('button', { name: 'Clear bill' }).click();
    await expect(page.getByText('Nothing in the bill yet.')).toBeVisible();
  });

  test('is honest that payment is not built yet: the pay button is disabled', async ({ page }) => {
    await page.goto('/pos');
    await expect(page.getByRole('button', { name: 'Take payment' })).toBeDisabled();
  });

  test('the whole bill can be operated with the keyboard', async ({ page }) => {
    await page.goto('/pos');
    const add = page.getByRole('button', { name: /Add Creatine/ });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: /One more Creatine/ }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('cell', { name: '₹1,798.00' })).toBeVisible();
  });
});

test('the skip link is the first thing a keyboard user reaches and jumps to the main content', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
