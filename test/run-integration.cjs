/**
 * `pnpm test:integration`: Jest twice over test/integration/, because no one
 * setting suits every suite (see NEEDS_VM_MODULES in jest-integration.config.js).
 * Arguments go to both runs, so `pnpm test:integration -- email` still picks
 * suites by name; a run the pattern leaves empty passes.
 */
const { spawnSync } = require('child_process')
const path = require('path')

const jest = require.resolve('jest/bin/jest')
const config = path.join(__dirname, 'jest-integration.config.js')
const args = process.argv.slice(2).filter((arg) => arg !== '--')

function run(withVmModules) {
    const inherited = (process.env.NODE_OPTIONS ?? '').replace('--experimental-vm-modules', '').trim()
    const env = {
        ...process.env,
        NODE_OPTIONS: withVmModules ? `${inherited} --experimental-vm-modules`.trim() : inherited
    }
    const result = spawnSync(process.execPath, [jest, '--config', config, '--passWithNoTests', ...args], {
        stdio: 'inherit',
        env
    })
    return result.status ?? 1
}

const plain = run(false)
const vmModules = run(true)
process.exit(plain || vmModules)
