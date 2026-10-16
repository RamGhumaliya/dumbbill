import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Proves the "no raw PrismaService in business code" lint rule really fires.
 * A rule that silently stopped working would let a tenant-data leak slip in, so we test the rule itself.
 *
 * ESLint is run as a separate process (the same command developers run) on a code snippet that
 * pretends to live at the given path.
 */
const ROOT = join(__dirname, '..', '..');
const ESLINT = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

/** Lint `code` as if it were the file at `filePath`; return the rule ids that were violated. */
function lintAs(filePath: string, code: string): string[] {
  const result = spawnSync(
    process.execPath,
    [ESLINT, '--stdin', '--stdin-filename', filePath, '--format', 'json'],
    { cwd: ROOT, input: code, encoding: 'utf8' },
  );
  const report = JSON.parse(result.stdout) as Array<{ messages: Array<{ ruleId: string | null }> }>;
  return (report[0]?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

const IMPORT_SERVICE = `import { PrismaService } from '../prisma/prisma.service';\nexport const x = PrismaService;\n`;
const NEW_CLIENT = `import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();\n`;

describe('tenant-safety lint rule', () => {
  it('blocks importing PrismaService in a business module', () => {
    expect(lintAs('src/modules/products/products.service.ts', IMPORT_SERVICE)).toContain(
      'no-restricted-imports',
    );
  });

  it('blocks creating a PrismaClient in application code', () => {
    expect(lintAs('src/modules/products/products.service.ts', NEW_CLIENT)).toContain(
      'no-restricted-syntax',
    );
  });

  it('allows the tenancy module, the prisma module and the readiness probe', () => {
    for (const allowed of [
      'src/modules/tenancy/tenant-tx.service.ts',
      'src/modules/prisma/prisma.module.ts',
      'src/modules/health/health.controller.ts',
    ]) {
      expect(lintAs(allowed, IMPORT_SERVICE)).not.toContain('no-restricted-imports');
    }
  });
});
