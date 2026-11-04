/**
 * Shared by every Jest config: compile ESM-only dependencies instead of
 * mocking them, so tests run against the real libraries.
 *
 * Jest's CommonJS runtime cannot load ESM-only packages, and ts-jest only
 * compiles plain JavaScript with `allowJs`. Add a package to ESM_PACKAGES when
 * a suite fails with "Cannot use import statement outside a module".
 */
const ESM_PACKAGES = [
    'jose',
    'openid-client',
    'oauth4webapi',
    'snakecase-keys',
    'camelcase-keys',
    'camelcase',
    'change-case',
    'map-obj',
    'quick-lru'
]

module.exports = {
    transform: {
        // isolatedModules: compile each file on its own, without type-checking
        // the program, which makes the suites about three times faster. Types
        // are checked by `tsc --noEmit` and lint, in CI and the git hooks.
        '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: { allowJs: true, isolatedModules: true } }]
    },
    // pnpm nests packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>.
    transformIgnorePatterns: [`node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(${ESM_PACKAGES.join('|')})/)`]
}
