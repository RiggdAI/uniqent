import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-web/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.schema.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // TypeScript's own checker handles undefined identifiers (incl. DOM/browser
    // globals); core `no-undef` produces false positives on TS, so disable it.
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'no-undef': 'off' },
  },
);
