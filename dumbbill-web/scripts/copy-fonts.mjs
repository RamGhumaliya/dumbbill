// Copies the font files the app uses from the @fontsource packages into src/fonts, so they are
// committed and SELF-HOSTED: the app never contacts Google or any font service, and builds work offline.
//
// Two subsets of each font are copied:
//   latin      letters, digits, punctuation
//   latin-ext  extra characters, INCLUDING the rupee sign (U+20B9) that every price in this product shows
//
// Run `pnpm fonts` only when changing fonts. The result is committed.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const target = join(root, 'src', 'fonts');
mkdirSync(join(target, 'licenses'), { recursive: true });

/** [package, file pattern] */
const wanted = [
  ['@fontsource-variable/inter-tight', /^inter-tight-latin(-ext)?-wght-normal\.woff2$/],
  ['@fontsource/barlow-condensed', /^barlow-condensed-latin(-ext)?-(500|600|700)-normal\.woff2$/],
  ['@fontsource-variable/jetbrains-mono', /^jetbrains-mono-latin(-ext)?-wght-normal\.woff2$/],
];

for (const [pkg, pattern] of wanted) {
  const packageDir = dirname(require.resolve(`${pkg}/package.json`));
  for (const file of readdirSync(join(packageDir, 'files')).filter((name) => pattern.test(name))) {
    copyFileSync(join(packageDir, 'files', file), join(target, file));
    process.stdout.write(`copied ${file}\n`);
  }
  // The fonts are licensed under the SIL Open Font License, which requires shipping the licence text.
  copyFileSync(
    join(packageDir, 'LICENSE'),
    join(target, 'licenses', `${pkg.split('/')[1]}-LICENSE.txt`),
  );
}
