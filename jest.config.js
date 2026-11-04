/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    // Use ts-jest for TypeScript
    preset: 'ts-jest',

    // Node environment for backend testing
    testEnvironment: 'node',

    // Root directory for tests
    rootDir: '.',

    // Look for test files in src directory
    roots: ['<rootDir>/src'],

    // Test file patterns
    testRegex: '.*\\.spec\\.ts$',

    // TypeScript, plus the ESM-only dependencies (see test/esm-transform.js)
    ...require('./test/esm-transform'),

    // Module path aliases (match tsconfig.json)
    moduleNameMapper: {
        '^@/generated/(.*)$': '<rootDir>/generated/$1',
        '^@/(.*)$': '<rootDir>/src/$1'
    },

    // File extensions to consider
    moduleFileExtensions: ['js', 'json', 'ts'],

    // Coverage configuration
    collectCoverageFrom: [
        '**/*.(t|j)s',
        '!**/*.spec.(t|j)s',
        '!**/*.e2e-spec.(t|j)s',
        '!**/node_modules/**',
        '!**/dist/**'
    ],
    coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/src/main.ts', '.*\\.module\\.ts$'],
    coverageDirectory: './coverage',

    // Setup files to run before tests
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

    // Cap worker count.
    //
    // Jest defaults to (cores - 1) workers, and each one loads its own ts-jest
    // program plus the Nest graph — on a 12-core machine that is enough
    // concurrent heaps to OOM `pnpm test` outright. 50% is comfortably fast
    // and leaves headroom.
    maxWorkers: '50%',

    // Test timeout (useful for integration tests)
    testTimeout: 30000,

    // Clear mocks between tests
    clearMocks: true,

    // Verbose output
    verbose: true
}
