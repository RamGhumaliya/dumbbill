import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Lint rules. Besides general code quality, this file enforces one security rule:
 * business code must reach the database through `TenantTx`, never through the raw PrismaService.
 * (Why: docs/adr/002-prisma-rls.md. The rule is itself tested in test/unit/lint-rules.spec.ts.)
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'prisma/migrations', 'jest.config.js', 'commitlint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // --- Tenant-safety rule: applies to all application code under src/ ---
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/prisma/prisma.service'],
              message:
                'Do not use PrismaService in business code: it has no tenant set, so row-level security would hide (or, if bypassed, leak) data. Inject TenantTx and use tenantTx.run(tx => ...) instead. See docs/adr/002-prisma-rls.md.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='PrismaClient']",
          message:
            'Do not create PrismaClient instances in application code. Use TenantTx (see docs/adr/002-prisma-rls.md).',
        },
      ],
    },
  },

  // --- The only places allowed to touch the raw client ---
  //   prisma/   the client itself
  //   tenancy/  TenantTx, which opens the tenant-locked transactions
  //   health/   the readiness probe, which runs `SELECT 1` and reads no business data
  {
    files: [
      'src/modules/prisma/**/*.ts',
      'src/modules/tenancy/**/*.ts',
      'src/modules/health/health.controller.ts',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
);
