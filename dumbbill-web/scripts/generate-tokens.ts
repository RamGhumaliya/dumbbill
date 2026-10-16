/**
 * Generates the web app's design-token files from docs/02-design/tokens/tokens.json.
 *
 *   pnpm tokens          write the generated files (after editing the JSON)
 *   pnpm tokens:check    only check that the files are up to date and every colour passes contrast (used by tests)
 *
 * It refuses to generate anything if a colour pair is too faint to read (WCAG contrast), so an
 * inaccessible palette can never reach the app.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contrastReport, generateAll, validateTokens, type TokenFile } from './lib/tokens';

const webRoot = join(__dirname, '..');
const tokenPath = join(webRoot, '..', 'docs', '02-design', 'tokens', 'tokens.json');
const checkOnly = process.argv.includes('--check');

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const tokens = JSON.parse(readFileSync(tokenPath, 'utf8')) as TokenFile;

const problems = validateTokens(tokens);
if (problems.length > 0) {
  process.stderr.write(
    `Design tokens are not valid:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}

const files = generateAll(tokens);
let stale = 0;
for (const [relativePath, contents] of Object.entries(files)) {
  const target = join(webRoot, relativePath);
  let current = '';
  try {
    current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // file does not exist yet
  }
  if (current === contents) continue;
  if (checkOnly) {
    stale += 1;
    process.stderr.write(`Out of date: ${relativePath}. Run \`pnpm tokens\`.\n`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
    out(`Wrote ${relativePath}`);
  }
}

if (checkOnly && stale > 0) process.exit(1);

const report = contrastReport(tokens);
const lowest = report.reduce((a, b) => (a.ratio / a.min < b.ratio / b.min ? a : b));
out(
  `${report.length} contrast checks passed. Tightest: ${lowest.theme} ${lowest.fg} on ${lowest.bg} = ${lowest.ratio.toFixed(2)}:1 (needs ${lowest.min}:1).`,
);
