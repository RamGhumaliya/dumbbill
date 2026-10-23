import { expect, test } from '@playwright/test';
import {
  bpToPercentText,
  diffFromRole,
  groupPermissions,
  percentTextToBp,
} from '@/components/team/team-helpers';

/**
 * The team forms turn a percentage box into basis points and a ticked list into "extras" and "taken away". Both are
 * easy to get subtly wrong, so they are pinned down here without a browser page.
 */

test.describe('percentage boxes', () => {
  test('basis points read back as the text a person would type', () => {
    expect(bpToPercentText(500)).toBe('5');
    expect(bpToPercentText(750)).toBe('7.5');
    expect(bpToPercentText(725)).toBe('7.25');
    expect(bpToPercentText(10_000)).toBe('100');
    expect(bpToPercentText(0)).toBe('0');
    expect(bpToPercentText(null)).toBe('');
  });

  test('typed text becomes whole basis points without float rounding', () => {
    expect(percentTextToBp('5')).toBe(500);
    expect(percentTextToBp(' 7.5 ')).toBe(750);
    expect(percentTextToBp('7.25%')).toBe(725);
    expect(percentTextToBp('0.1')).toBe(10);
    expect(percentTextToBp('100')).toBe(10_000);
    expect(percentTextToBp('')).toBeNull();
  });

  test('anything that is not 0 to 100 with at most two decimals is invalid', () => {
    for (const bad of ['101', '100.01', '-1', '5.123', 'five', '5,5', '1e2']) {
      expect(percentTextToBp(bad)).toBe('invalid');
    }
  });
});

test.describe('abilities against a role', () => {
  test('ticked-but-not-in-role are extras; in-role-but-unticked are taken away', () => {
    const role = ['products.read', 'pos.sell', 'discount.apply'];
    const ticked = new Set(['products.read', 'pos.sell', 'stock.adjust']);
    expect(diffFromRole(role, ticked)).toEqual({
      extra: ['stock.adjust'],
      denied: ['discount.apply'],
    });
  });

  test('ticking exactly what the role gives changes nothing', () => {
    const role = ['products.read', 'pos.sell'];
    expect(diffFromRole(role, new Set(role))).toEqual({ extra: [], denied: [] });
  });
});

test('the permission catalogue is grouped in the server order', () => {
  const info = (key: string, group: string) => ({
    key,
    group,
    label: key,
    description: '',
    confidential: false,
  });
  const grouped = groupPermissions([
    info('products.read', 'Products'),
    info('stock.adjust', 'Stock'),
    info('products.write', 'Products'),
  ]);
  expect(grouped.map((entry) => entry.group)).toEqual(['Products', 'Stock']);
  expect(grouped[0]?.items.map((item) => item.key)).toEqual(['products.read', 'products.write']);
});
