import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { contrastRatio } from '../../scripts/lib/contrast';
import {
  contrastReport,
  generateAll,
  validateTokens,
  type TokenFile,
} from '../../scripts/lib/tokens';

/**
 * The design tokens are the foundation of the whole look, so they are checked hard:
 *  - every colour pair that appears on screen meets its WCAG contrast minimum, in BOTH themes
 *  - every colour role is covered by a check (nothing slips in unmeasured)
 *  - the generated CSS is exactly what the JSON says (nobody edited a generated file by hand)
 * The "catches mistakes" tests break a copy of the tokens on purpose and expect the checker to complain.
 */
const WEB_ROOT = join(__dirname, '..', '..');
const tokens = JSON.parse(
  readFileSync(join(WEB_ROOT, '..', 'docs', '02-design', 'tokens', 'tokens.json'), 'utf8'),
) as TokenFile;

/** A deep copy that tests can damage without touching the real tokens. */
const clone = (): TokenFile => JSON.parse(JSON.stringify(tokens)) as TokenFile;

test.describe('contrast maths', () => {
  test('black on white is the maximum, 21:1, and identical colours are 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  test('order does not matter and 3-digit colours work', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(contrastRatio('#000', '#fff'), 5);
  });

  test('rejects values that are not hex colours', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow(/Not a hex colour/);
  });
});

test.describe('the real tokens', () => {
  test('are complete and every contrast pair passes in both themes', () => {
    expect(validateTokens(tokens)).toEqual([]);
  });

  test('check dozens of pairs, and the tightest one still has headroom over its minimum', () => {
    const report = contrastReport(tokens);
    expect(report.length).toBeGreaterThanOrEqual(50);
    for (const { theme, fg, bg, ratio, min } of report) {
      expect(ratio, `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
    }
  });

  test('the generated files are up to date (run `pnpm tokens` if this fails)', () => {
    for (const [path, expected] of Object.entries(generateAll(tokens))) {
      const actual = readFileSync(join(WEB_ROOT, path), 'utf8').replace(/\r\n/g, '\n');
      expect(actual, `${path} is out of date`).toBe(expected);
    }
  });

  test('the dark and light themes both define every role, and differ', () => {
    for (const role of Object.keys(tokens.color.roles)) {
      expect(tokens.color.dark[role], `dark ${role}`).toBeTruthy();
      expect(tokens.color.light[role], `light ${role}`).toBeTruthy();
    }
    expect(tokens.color.dark['bg.base']).not.toBe(tokens.color.light['bg.base']);
  });

  test('the generated CSS carries both themes and the system-preference fallback', () => {
    const css = generateAll(tokens)['src/styles/tokens.css'] ?? '';
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('--bg-base: #fbfaf8'); // light default (Quiet Ledger)
    expect(css).toContain('--accent: #c6f432'); // dark accent (Iron Ledger volt)
  });

  test('Tailwind is told to forget its default colours, radii, sizes and shadows', () => {
    const theme = generateAll(tokens)['src/styles/tailwind-theme.css'] ?? '';
    for (const reset of [
      '--color-*: initial',
      '--radius-*: initial',
      '--text-*: initial',
      '--shadow-*: initial',
    ]) {
      expect(theme).toContain(reset);
    }
  });

  test('numerals and code fonts fall back to Inter Tight, because only Inter Tight has the rupee sign', () => {
    const theme = generateAll(tokens)['src/styles/tailwind-theme.css'] ?? '';
    expect(theme).toMatch(/--font-display:[^;]*--font-ui-latin/);
    expect(theme).toMatch(/--font-mono:[^;]*--font-ui-ext/);
  });
});

test.describe('the checker catches mistakes', () => {
  test('a colour that is too faint', () => {
    const broken = clone();
    broken.color.light['text.muted'] = '#b0b0b0';
    expect(validateTokens(broken).join('\n')).toMatch(
      /light: text\.muted .* on bg\.base .* needs 4\.5:1/,
    );
  });

  test('a control edge that is too faint (WCAG 1.4.11 needs 3:1)', () => {
    const broken = clone();
    broken.color.dark['border.control'] = '#222428';
    expect(validateTokens(broken).join('\n')).toMatch(/dark: border\.control .* needs 3:1/);
  });

  test('a role that has a value in only one theme', () => {
    const broken = clone();
    delete broken.color.dark['accent.hover'];
    expect(validateTokens(broken).join('\n')).toMatch(/dark: role "accent\.hover" has no colour/);
  });

  test('a value that is not a colour', () => {
    const broken = clone();
    broken.color.light.accent = 'teal';
    expect(validateTokens(broken).join('\n')).toMatch(/light: "accent" is not a valid colour/);
  });

  test('a new colour role that nobody checked for contrast', () => {
    const broken = clone();
    broken.color.roles['brand.extra'] = { tailwind: 'extra', use: 'x' };
    broken.color.dark['brand.extra'] = '#123456';
    broken.color.light['brand.extra'] = '#654321';
    expect(validateTokens(broken).join('\n')).toMatch(/role "brand\.extra" has no contrast check/);
  });

  test('two roles with the same Tailwind name', () => {
    const broken = clone();
    broken.color.roles['bg.hover'] = { tailwind: 'surface', use: 'x' };
    expect(validateTokens(broken).join('\n')).toMatch(/share the same Tailwind name/);
  });

  test('a contrast pair that names an unknown role', () => {
    const broken = clone();
    broken.contrast.push({ fg: 'text', bg: 'bg.nowhere', min: 4.5, use: 'x' });
    expect(validateTokens(broken).join('\n')).toMatch(/unknown role/);
  });
});
