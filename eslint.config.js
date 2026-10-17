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
      '**/target/**', // Cargo build artifacts (apps/studio/src-tauri)
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
  {
    // Browser-safe modules (bundled into the native Studio UI): no Node APIs.
    files: [
      'packages/core/src/{pure,bundle,errors,secret-scan,validate,secret-refs}.ts',
      'packages/builder/src/{hubs,memory}/**/*.ts',
      'packages/builder/src/{hubs-entry,memory-entry}.ts',
      'packages/adapter-sdk/src/{pure,pure-paths,credentials,io,types}.ts',
      'packages/builder/src/{brain,brain-entry,derive,scrub,detect-markers,describe-mcp}.ts',
      'packages/builder/src/catalog/**/*.ts',
      'packages/adapter-hermes/src/{pure,translate,capture,config,env,mcp,memory,channels}.ts',
      'packages/adapter-claude-code/src/{pure,translate,capture,mcp,agents-md}.ts',
      'packages/adapter-openclaw/src/{pure,translate,capture,config,env,workspace}.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'pure module: no Node APIs' }] },
      ],
      'no-restricted-globals': ['error', 'Buffer', 'process'],
    },
  },
);
