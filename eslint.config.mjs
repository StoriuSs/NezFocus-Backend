import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'
import { readdirSync } from 'node:fs'

// The feature modules: every folder under src/modules, so a new module is held
// by the import rules below from its first file (CONSTRAINTS.md, architecture).
const MODULES = readdirSync(new URL('./src/modules', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

// What a module may not import from another module's insides.
const moduleBans = (self) =>
  MODULES
    .filter((other) => other !== self)
    .map((other) => ({
      group: [`@/modules/${other}/*`, `!@/modules/${other}/${other}.module`],
      message: `Import from '@/modules/${other}' (its index.ts), or add what you need there.`,
    }))

// The dependency rule inside a module (docs/hexagonal-architecture.md): the
// domain is plain TypeScript and imports no other layer; the application
// reaches storage and the outside world only through ports. CONSTRAINTS.md
// enforces it. Tests are exempt: they wire real adapters on purpose.
const LAYER_BANS = {
  domain: [
    { regex: '^@nestjs/|^@prisma/|^@/generated/', message: 'The domain is plain TypeScript: no framework or database imports.' },
    { regex: '(^|/)(application|infrastructure|presentation)(/|$)', message: 'The domain imports nothing from the other layers.' },
  ],
  application: [
    { regex: '^@prisma/|^@/generated/', message: 'The application reaches the database through a repository port, not Prisma.' },
    { regex: '(^|/)(infrastructure|presentation)(/|$)', message: 'The application talks to adapters through ports; the module file wires them in.' },
  ],
}
const TESTS = ['**/*.spec.ts', '**/*-spec.ts']

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
  //
  // The layer rule (LAYER_BANS) sets the same ESLint rule on domain/ and
  // application/, and a later config replaces a rule's options rather than
  // adding to them, so those configs repeat the module patterns.
  ...MODULES.flatMap((self) => [
    {
      files: [`src/modules/${self}/**/*.ts`],
      rules: { 'no-restricted-imports': ['error', { patterns: moduleBans(self) }] },
    },
    ...Object.entries(LAYER_BANS).map(([layer, bans]) => ({
      files: [`src/modules/${self}/${layer}/**/*.ts`],
      ignores: TESTS,
      rules: { 'no-restricted-imports': ['error', { patterns: [...moduleBans(self), ...bans] }] },
    })),
  ]),
  {
    files: ['src/shared/domain/**/*.ts'],
    ignores: TESTS,
    rules: { 'no-restricted-imports': ['error', { patterns: LAYER_BANS.domain }] },
  },
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
