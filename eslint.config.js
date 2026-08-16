import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused variables are errors, but an underscore prefix marks an
      // intentional omission (e.g. unused Express `next` parameters).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Blockchain values are bigint-heavy; template literals over them are
      // deliberate and safe.
      '@typescript-eslint/restrict-template-expressions': 'off',
      'no-console': 'off',
    },
  },
);
