/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    // Use ts-jest for TypeScript
    preset: 'ts-jest',

    // Node environment
    testEnvironment: 'node',

    // Root directory
    rootDir: '..',

    // The folder decides which command runs a suite: anything in test/e2e/
    // runs here, anything in test/integration/ runs under
    // jest-integration.config.js. The .e2e-spec.ts / .integration-spec.ts
    // suffixes are kept for readability, but the directory is what selects,
    // so a file can never fall between the two commands.
    roots: ['<rootDir>/test/e2e'],
    testRegex: '-spec\\.ts$',

    // TypeScript, plus the ESM-only dependencies (see esm-transform.js)
    ...require('./esm-transform'),

    // Module path aliases (match tsconfig.json)
    moduleNameMapper: {
        '^@/generated/(.*)$': '<rootDir>/generated/$1',
        '^@/(.*)$': '<rootDir>/src/$1'
    },

    // File extensions
    moduleFileExtensions: ['js', 'json', 'ts'],

    // Setup files
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

    // E2E specs need nothing but Node: each builds a small Nest app with
    // Postgres and Redis replaced by fakes (docs/testing.md). One worker keeps
    // the run light; real services are the integration suite's job.
    maxWorkers: 1,

    // Longer timeout for E2E tests (they spin up the full app)
    testTimeout: 60000,

    // Clear mocks between tests
    clearMocks: true,

    // Verbose output
    verbose: true
}
