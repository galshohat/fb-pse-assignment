import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The rules of hooks are not style: breaking them produces components that
  // work until a re-render order changes. Only the web package has components.
  {
    files: ['services/web/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },
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
