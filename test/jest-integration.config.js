/** @type {import('ts-jest').JestConfigWithTsJest} */
const base = require('./jest-e2e.config')

/**
 * Integration tests: suites that talk to real backing services.
 *
 * Kept apart from the e2e suites, which must run with nothing but Node
 * installed. Selection is by directory — everything in test/integration/ —
 * rather than by listing files to exclude, so a new suite lands in the right
 * command just by where it is created and nothing has to be remembered.
 *
 *   integration/cache.integration-spec.ts       -> Redis
 *   integration/s3-storage.integration-spec.ts  -> RustFS (S3-compatible)
 *   integration/email.integration-spec.ts       -> Mailpit (SMTP catcher)
 *
 * Locally: `pnpm test:services:up`, then `pnpm test:integration` (which runs
 * test/run-integration.cjs; `pnpm test:integration -- email` picks suites).
 * In CI: run the same images as service containers; every connection target is
 * overridable through TEST_* environment variables.
 */
/**
 * Suites that need Node's --experimental-vm-modules. The AWS SDK loads
 * `node:http` with a dynamic import() for plain-http endpoints (RustFS here),
 * and Jest runs a dynamic import only with that flag. But with the flag, Jest
 * loads ESM-only packages (jose) as native ES modules, which a CommonJS test
 * can require only on Node 24.9+. So test/run-integration.cjs runs Jest twice:
 * these suites with the flag, every other suite without it.
 */
const NEEDS_VM_MODULES = ['s3-storage']
const withVmModules = (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
const group = `(${NEEDS_VM_MODULES.join('|')})\\.integration-spec\\.ts$`

module.exports = {
    ...base,
    roots: ['<rootDir>/test/integration'],
    testRegex: withVmModules ? group : '-spec\\.ts$',
    testPathIgnorePatterns: withVmModules ? [] : [group],

    // Fail fast with an actionable message when a service is missing, instead
    // of every suite timing out one by one. Deliberately NOT a skip: a skipped
    // integration suite lets CI go green without testing anything.
    globalSetup: '<rootDir>/test/integration/global-setup.ts',

    // Shared real services — never race workers against the same state.
    maxWorkers: 1
}
