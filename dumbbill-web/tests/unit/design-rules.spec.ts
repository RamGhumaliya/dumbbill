import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * "No raw colours and no raw pixel sizes outside the design tokens."
 *
 * Two guards, because styles live in two kinds of files:
 *   - TypeScript/TSX: enforced by an ESLint rule (also run by `pnpm lint`). Here we PROVE the rule fires.
 *   - CSS: scanned directly by this test (ESLint does not read CSS).
 * The three generated token files are the only places raw values are allowed: that is where they are defined.
 */
const WEB_ROOT = join(__dirname, '..', '..');
const SRC = join(WEB_ROOT, 'src');
const GENERATED = new Set([
  'src/styles/tokens.css',
  'src/styles/tailwind-theme.css',
  'src/lib/design/token-names.ts',
]);

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'fonts' ? [] : filesUnder(full, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [full] : [];
  });
}

/** Remove /* comments *\/ so that words like "16 px" in documentation are not mistaken for styles. */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

test.describe('CSS files', () => {
  const cssFiles = filesUnder(SRC, ['.css']).filter(
    (file) => !GENERATED.has(relative(WEB_ROOT, file).replaceAll('\\', '/')),
  );

  test('there are hand-written CSS files to check', () => {
    expect(cssFiles.length).toBeGreaterThanOrEqual(2); // globals.css and animations.css
  });

  for (const file of cssFiles) {
    const name = relative(WEB_ROOT, file).replaceAll('\\', '/');

    test(`${name} has no raw colours`, () => {
      const hits = withoutComments(readFileSync(file, 'utf8')).match(/#[0-9a-fA-F]{3,8}\b/g);
      expect(hits ?? [], 'use a design token variable such as var(--bg-base)').toEqual([]);
    });

    test(`${name} has no raw pixel values`, () => {
      const hits = withoutComments(readFileSync(file, 'utf8')).match(/(?<![\w-])-?\d*\.?\d+px\b/g);
      expect(
        hits ?? [],
        'use a token such as var(--motion-shift) or var(--focus-ring-width)',
      ).toEqual([]);
    });
  }
});

test.describe('the ESLint design-token rule', () => {
  const ESLINT = join(WEB_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

  /** Lint a snippet as if it were the file `src/components/example.tsx`; return the messages of the rule. */
  function lint(code: string): string[] {
    const run = spawnSync(
      process.execPath,
      [ESLINT, '--stdin', '--stdin-filename', 'src/components/example.tsx', '--format', 'json'],
      { cwd: WEB_ROOT, input: code, encoding: 'utf8' },
    );
    const report = JSON.parse(run.stdout) as Array<{
      messages: Array<{ ruleId: string | null; message: string }>;
    }>;
    return (report[0]?.messages ?? [])
      .filter((m) => m.ruleId === 'no-restricted-syntax')
      .map((m) => m.message);
  }

  const wrap = (body: string): string => `export const x = ${body};\n`;

  test('flags a raw colour in a string, a Tailwind class and a template string', () => {
    expect(lint(wrap("'#ff0000'")).join()).toMatch(/Raw colour/);
    expect(lint(wrap("'bg-[#0e0f11] p-2'")).join()).toMatch(/Raw colour/);
    expect(lint(wrap('`color: #fff;`')).join()).toMatch(/Raw colour/);
    expect(lint(wrap("'#0e0f11'")).length).toBeGreaterThan(0);
  });

  test('flags arbitrary Tailwind sizes and raw pixel values', () => {
    expect(lint(wrap("'w-[13px] h-4'")).join()).toMatch(/Arbitrary Tailwind size/);
    expect(lint(wrap("'mt-[0.5rem]'")).join()).toMatch(/Arbitrary Tailwind size/);
    expect(lint(wrap("'12px'")).join()).toMatch(/Raw pixel value/);
    expect(lint(wrap("'padding: 8px 4px;'")).join()).toMatch(/Raw pixel value/);
  });

  test('leaves ordinary code alone: token classes, size tokens, page anchors, calc and plain words', () => {
    for (const fine of [
      "'bg-surface text-muted rounded-card p-4'",
      "'min-h-(--size-control-md) size-8'",
      "'#main'", // a link to a part of the page, not a colour
      "'#add-form'",
      "'w-[calc(100%-2rem)]'",
      "'The 48 px target is a guideline'",
      '`var(${cssVar})`',
    ]) {
      expect(lint(wrap(fine)), fine).toEqual([]);
    }
  });
});
