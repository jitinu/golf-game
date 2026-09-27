import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/public/courses/**/*.f32', '**/public/courses/**/*.u8'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
