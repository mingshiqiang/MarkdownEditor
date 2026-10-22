// @ts-check
import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // `*.config.ts.<timestamp>.mjs` are temporary bundles written by electron-vite
    // while the dev server runs; they can disappear while ESLint reads the tree.
    ignores: [
      'out/**',
      'release*/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'scripts/**/node_modules/**',
      '**/*.config.ts.*.mjs'
    ]
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    }
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      // Single-word component names (Modal, TabsBar…) are deliberate here.
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    // TypeScript resolves names (e.g. DOM option types) itself.
    files: ['**/*.{ts,mts,vue}'],
    rules: {
      'no-undef': 'off'
    }
  },
  {
    // Plain CommonJS scripts (manual Electron check helpers, release cleanup).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  // Formatting is owned by Prettier; this must come last.
  eslintConfigPrettier
)
