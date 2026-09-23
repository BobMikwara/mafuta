// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Node globals for scripts that run outside the TypeScript compilation. */
const NODE_GLOBALS = {
  process: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
  structuredClone: 'readonly',
  setTimeout: 'readonly',
  clearInterval: 'readonly',
  setInterval: 'readonly',
};

/** Browser globals for the dashboard assets, which are served as static files. */
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  sessionStorage: 'readonly',
  localStorage: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.git/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...NODE_GLOBALS,
        ...BROWSER_GLOBALS,
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['apps/api-server/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: BROWSER_GLOBALS,
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
