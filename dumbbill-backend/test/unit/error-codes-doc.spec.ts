import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderErrorCodesMarkdown } from '../../src/common/errors/error-codes-doc';

/**
 * docs/api/error-codes.md is what web and mobile developers read. It is generated from the catalogue,
 * so if someone adds an error code and forgets to regenerate, this test fails and says what to run.
 */
describe('docs/api/error-codes.md', () => {
  it('is up to date with the error catalogue (run `pnpm docs:errors` if this fails)', () => {
    const committed = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'api', 'error-codes.md'),
      'utf8',
    );
    expect(committed.replace(/\r\n/g, '\n')).toBe(renderErrorCodesMarkdown());
  });
});
