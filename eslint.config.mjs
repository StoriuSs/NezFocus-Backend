import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

// The feature modules under src/modules: a new module's folder name goes here
// (the import rule below).
const MODULES = ['auth', 'users']

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
      // Flat config expects the actual global names here. The previous
      // `{ node: true, jest: true }` is the legacy .eslintrc `env` syntax: in
      // flat config it declared two globals literally named "node" and "jest",
      // so Node's real globals (require, module, process, __dirname) were never
      // enabled — which is why every CommonJS config file had to be ignored.
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // A feature module uses another only through what that one publishes: its
  // index.ts (`@/modules/users`) and its Nest module file. Its insides stay
  // free to move. The modules are MODULES, at the top of this file.
  // Outside src/modules the rule does not apply, on purpose: app.module.ts,
  // src/maintenance and the CLIs in src/bootstrap are where modules are wired
  // together, and a CLI builds a module's adapters itself, without Nest.
  ...MODULES.map((self) => ({
    files: [`src/modules/${self}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: MODULES
            .filter((other) => other !== self)
            .map((other) => ({
              group: [`@/modules/${other}/*`, `!@/modules/${other}/${other}.module`],
              message: `Import from '@/modules/${other}' (its index.ts), or add what you need there.`,
            })),
        },
      ],
    },
  })),
  {
    // Plain CommonJS tooling config (jest configs). Not part of the TypeScript
    // program, so type-aware rules are switched off for them rather than
    // excluding the files from linting altogether.
    files: ['**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    // k6 load-test scripts. ES modules that run in k6's own JavaScript
    // runtime rather than in Node: they import from k6's built-in modules
    // (which have no node_modules entry) and use globals k6 provides.
    files: ['k6/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'module',
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
        open: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/', 'dist-openapi/', 'node_modules/', 'generated/', '.pnpm-store/', 'eslint.config.mjs'],
  }
)
