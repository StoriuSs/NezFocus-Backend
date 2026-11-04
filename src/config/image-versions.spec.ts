import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import { composeFilePaths } from './env-check'

// An image is named in several files: the compose files, the Dockerfiles, the
// check scripts in package.json, scripts/*.sh, the CI workflow. Renovate
// updates them together (renovate.json, docs/renovate.md); this catches a file
// left behind, by Renovate or by hand.
const root = resolve(__dirname, '../..')
/** A file without its comment lines (`# ...`): examples there aren't pins. */
const read = (file: string) =>
    readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')

const files = [
    ...composeFilePaths(root),
    join(root, 'Dockerfile'),
    join(root, 'backup/Dockerfile'),
    join(root, 'package.json'),
    ...readdirSync(join(root, 'scripts'))
        .filter((name) => name.endsWith('.sh'))
        .map((name) => join(root, 'scripts', name)),
    ...readdirSync(join(root, '.github/workflows')).map((name) => join(root, '.github/workflows', name))
]

/**
 * `name:tag` references to published images. The same patterns renovate.json
 * gives its custom managers: a name with a slash (prom/prometheus), or one of
 * the official images used here without one. Tags start with a digit (or v and
 * a digit), which leaves out ports and paths (db:5432, ./x:/y).
 */
function imageReferences(content: string): { name: string; tag: string }[] {
    const found = [
        ...content.matchAll(/(?:^|[\s"'=-])((?:[a-z0-9][a-z0-9.-]*\/)+[a-z0-9._-]+):(v?\d[\w.-]*)/gm),
        ...content.matchAll(/(?:^|[\s"'=-])(postgres|redis|node):(v?\d[\w.-]*)/gm)
    ]
    return found.map((match) => ({ name: match[1], tag: match[2] }))
}

describe('image versions', () => {
    it('names one version of each image in every file, and the Node.js major .nvmrc names', () => {
        const byImage = new Map<string, Map<string, string[]>>()
        for (const file of files) {
            for (const { name, tag } of imageReferences(read(file))) {
                const tags = byImage.get(name) ?? new Map<string, string[]>()
                tags.set(tag, [...(tags.get(tag) ?? []), relative(root, file).replace(/\\/g, '/')])
                byImage.set(name, tags)
            }
        }
        // If the patterns stop matching, the check below proves nothing.
        expect([...byImage.keys()]).toEqual(expect.arrayContaining(['postgres', 'redis', 'node', 'prom/prometheus']))

        const disagreeing = [...byImage]
            .filter(([, tags]) => tags.size > 1)
            .map(
                ([name, tags]) =>
                    `${name}: ${[...tags].map(([tag, where]) => `${tag} in ${where.join(', ')}`).join('; ')}`
            )
        expect(disagreeing).toEqual([])

        const nodeTag = byImage.get('node')?.keys().next().value ?? ''
        const nvmrc = read(join(root, '.nvmrc')).trim()
        expect(nodeTag.split('.')[0].replace(/-.*/, '')).toBe(nvmrc.split('.')[0])
    })
})
