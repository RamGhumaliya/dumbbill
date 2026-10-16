import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Lint rules.
 *  - Next.js + React + hooks + TypeScript recommendations (nextVitals, nextTypescript)
 *  - Accessibility rules from jsx-a11y are raised from "warn" to "error": a POS used all day by
 *    staff must be fully keyboard operable and readable by screen readers.
 *  - Prettier last, so formatting never fights with lint.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],

      // Accessibility (the plugin itself is registered by eslint-config-next).
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/heading-has-content': 'error',
      'jsx-a11y/html-has-lang': 'error',
      'jsx-a11y/interactive-supports-focus': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/tabindex-no-positive': 'error',
    },
  },

  /*
   * DESIGN-TOKEN RULE: no raw colours and no raw pixel sizes in application code.
   * Colours and sizes live in ONE place (docs/02-design/tokens/tokens.json). Code uses the Tailwind classes
   * built from them (bg-surface, text-muted, rounded-card, text-small ...). A hard-coded "#fff" or
   * "w-[13px]" is how a product drifts away from its design, so it fails the lint. CSS files are checked
   * by tests/unit/design-rules.spec.ts. (The rule itself is tested in that file too.)
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/design/token-names.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // The same three checks run on plain strings (Literal) and on template strings (TemplateElement).
        ...[
          ['Literal', 'value'],
          ['TemplateElement', 'value.raw'],
        ].flatMap(([node, path]) => [
          {
            selector: String.raw`${node}[${path}=/(^|[^\w&])#[0-9a-fA-F]{3,8}($|[^\w-])/]`,
            message:
              'Raw colour. Use a design token class (bg-surface, text-muted, border-line ...). Colours are defined in docs/02-design/tokens/tokens.json.',
          },
          {
            selector: String.raw`${node}[${path}=/\[-?[0-9]*\.?[0-9]+(px|rem|em)\]/]`,
            message:
              'Arbitrary Tailwind size such as w-[13px]. Use the spacing scale or a size token, for example min-h-(--size-control-md).',
          },
          {
            selector: String.raw`${node}[${path}=/(^|[\s:])-?[0-9]*\.?[0-9]+px($|[\s;,)])/]`,
            message:
              'Raw pixel value. Use a design token (spacing scale, size or font-size token).',
          },
        ]),
      ],
    },
  },

  // Tests may print to the console while debugging.
  { files: ['tests/**/*.ts'], rules: { 'no-console': 'off' } },

  prettier,

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
  ]),
]);
