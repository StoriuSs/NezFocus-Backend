import { existsSync, readFileSync } from 'fs'
import { basename, join, resolve } from 'path'
import { composeFilePaths } from './env-check'

// The monitoring stack is configuration only: this check stands in for the
// compile errors it can't have.
const root = resolve(__dirname, '../..')

/** Sources of the repository files a compose file mounts (`./x:/y`). */
function mountedPaths(compose: string): string[] {
    return [...compose.matchAll(/^\s*-\s*["']?(\.\/[^:\s"']+):/gm)].map((match) => match[1])
}

describe('monitoring files', () => {
    it('mounts only files that exist, in every compose file', () => {
        const missing = composeFilePaths(root).flatMap((file) =>
            mountedPaths(readFileSync(file, 'utf8'))
                .filter((path) => !existsSync(join(root, path)))
                .map((path) => `${basename(file)}: ${path}`)
        )
        expect(missing).toEqual([])
    })
})
