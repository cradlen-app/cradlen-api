// @ts-check
import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'prisma.config.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.eslint.json',
        },
        node: true,
      },
    },
    rules: {
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/common',
              from: './src',
              // ./infrastructure/logging is allowed because LoggingInterceptor
              // (in common/) needs the Pino logger. Revisit if the interceptor
              // moves out of common.
              except: ['./common', './config', './infrastructure/logging'],
              message:
                'common/ is the foundation layer and may not import from other layers.',
            },
            {
              target: './src/infrastructure',
              from: './src/core',
              message: 'infrastructure must not import from core.',
            },
            {
              target: './src/infrastructure',
              from: './src/builder',
              message: 'infrastructure must not import from builder.',
            },
            {
              target: './src/infrastructure',
              from: './src/plugins',
              message: 'infrastructure must not import from plugins.',
            },
            {
              target: './src/builder',
              from: './src/core',
              message: 'builder must not import from core.',
            },
            {
              target: './src/builder',
              from: './src/plugins',
              message: 'builder must not import from plugins.',
            },
            {
              target: './src/core',
              from: './src/plugins',
              message: 'core must not import from plugins.',
            },
            {
              target: './src/plugins',
              from: './src/core',
              except: ['**/*.module.ts', '**/*.public.ts'],
              message:
                'plugins may only import from core via *.module.ts or *.public.ts files.',
            },
          ],
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);
