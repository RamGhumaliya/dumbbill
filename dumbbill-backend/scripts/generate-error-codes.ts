/**
 * Writes docs/api/error-codes.md from the error catalogue in src/common/errors/error-codes.ts.
 *
 * The catalogue is the single source of truth, so this document can never disagree with the API.
 * Run `pnpm docs:errors` after adding or changing an error code, and commit the result.
 * (A unit test fails if the committed file is out of date.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderErrorCodesMarkdown } from '../src/common/errors/error-codes-doc';

const OUTPUT = join(__dirname, '..', '..', 'docs', 'api', 'error-codes.md');

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, renderErrorCodesMarkdown(), 'utf8');
process.stdout.write(`Wrote ${OUTPUT}\n`);
