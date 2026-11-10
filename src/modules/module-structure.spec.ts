import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The "Names and places" table of docs/adding-a-module.md, checked on the
 * tree (CONSTRAINTS.md, Kiến trúc: tên và chỗ đặt file). A file the table has
 * no place for fails here: a new kind of file is a new row in the table first,
 * then a pattern below.
 */

/** A kebab-case name with no dot in it: `place-order`, `server-locks`. */
const NAME = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*'

/**
 * The name of a file with no suffix (a rule, a shared step, a helper), but not
 * a barrel, not a folder's word used as a file (`domain/errors.ts`, the
 * single-file shape `domain/errors/` replaced), and not a Prisma file without
 * its suffix.
 */
const HELPER = `(?!(?:index|errors|ports|entities)\\.)(?!prisma-)${NAME}`

/** Where each file may sit, relative to its module's folder (`{m}` is the module). */
const PLACES: string[] = [
    // The module
    'index\\.ts',
    '{m}\\.module\\.ts',
    // Domain
    'domain/index\\.ts',
    `domain/${HELPER}(?:\\.rules)?\\.ts`,
    `domain/entities/${NAME}\\.entity\\.ts`,
    `domain/errors/(?:index|${NAME}\\.errors)\\.ts`,
    `domain/ports/(?:index|${NAME}\\.repository\\.port)\\.ts`,
    // Application
    'application/index\\.ts',
    `application/${NAME}-settings\\.ts`,
    'application/rate-limits\\.ts',
    // A repository port is in domain/ports, whatever it is called here.
    `application/ports/(?:index|(?![a-z0-9-]*-repository\\.port\\.)${NAME}\\.port)\\.ts`,
    // Which pair a folder holds: the test "keeps each command and query folder to one form".
    `application/commands/(${NAME})/\\1\\.(?:command|handler|commands|handlers)\\.ts`,
    `application/queries/(${NAME})/\\1\\.(?:query|handler|queries|handlers)\\.ts`,
    `application/events/${NAME}\\.event\\.ts`,
    `application/events/handlers/${NAME}\\.handler\\.ts`,
    `application/services/${HELPER}\\.ts`,
    // Infrastructure
    'infrastructure/index\\.ts',
    `infrastructure/persistence/prisma-${NAME}\\.(?:repository|adapter)\\.ts`,
    `infrastructure/persistence/${HELPER}(?:\\.selections)?\\.ts`,
    // A Prisma adapter is in persistence/ (HELPER refuses `prisma-`).
    `infrastructure/adapters/${HELPER}(?:\\.adapter)?\\.ts`,
    `infrastructure/mappers/${NAME}\\.mapper\\.ts`,
    `infrastructure/email/${HELPER}\\.ts`,
    `infrastructure/email/templates/${NAME}\\.hbs`,
    // Presentation
    'presentation/index\\.ts',
    `presentation/http/(?:index|${HELPER}(?:\\.controller|\\.pipe|\\.presenter)?)\\.ts`,
    `presentation/http/dto/(?:index|${NAME}\\.(?:request|response|params|query)\\.dto|${NAME}\\.decorators)\\.ts`,
    `presentation/http/dto/shared/(?:${NAME}\\.dto|fields)\\.ts`,
    `presentation/consumers/${NAME}\\.consumer\\.ts`,
    `presentation/guards/${NAME}\\.guard\\.ts`,
    `presentation/rate-limit/${HELPER}\\.ts`
]

/** A test file: `login.handler.spec.ts`, `auth-test-world.shared-spec.ts`. */
const SPEC = `(?:${NAME}\\.)*${NAME}\\.(?:spec|shared-spec)\\.ts`

const MODULES_DIR = __dirname

const modules = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

/** Every file under a folder, as a path relative to it with forward slashes. */
const filesIn = (dir: string, prefix = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesIn(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
    )

const placesOf = (moduleName: string): RegExp[] =>
    PLACES.map((place) => new RegExp(`^${place.replaceAll('{m}', moduleName)}$`))

/**
 * A spec sits beside the code it tests, or above it when it tests several
 * (auth's specs in `application/commands/`): in a folder that holds source
 * files, directly or below.
 */
const specFolderAllowed = (folder: string, files: string[]): boolean =>
    files.some((file) => !isSpec(file) && file.startsWith(folder))

const isSpec = (file: string): boolean => new RegExp(`(?:^|/)${SPEC}$`).test(file)

const folderOf = (file: string): string => file.slice(0, file.lastIndexOf('/') + 1)

/**
 * `ban-list.query` → `banlistquery`: names are compared without case or
 * hyphens, so `OAuth` and `Oauth` both match `oauth`. The price: a class
 * spelt `BanlistQueryDto` passes too; review catches that, this catches the
 * wrong name.
 */
const squash = (name: string): string => name.replaceAll(/[-.]/g, '').toLowerCase()

const read = (moduleName: string, file: string): string => readFileSync(join(MODULES_DIR, moduleName, file), 'utf8')

/** Every class a file declares, exported or not. */
const classesIn = (source: string): { name: string; exported: boolean }[] =>
    [...source.matchAll(/^(export\s+)?(?:abstract\s+)?class\s+(\w+)/gm)].map((match) => ({
        name: match[2],
        exported: match[1] !== undefined
    }))

describe('module structure (docs/adding-a-module.md, Names and places)', () => {
    it('finds the modules', () => {
        expect(modules).toEqual(expect.arrayContaining(['auth', 'users', 'servers', 'permissions']))
    })

    describe.each(modules)('%s', (moduleName) => {
        const files = filesIn(join(MODULES_DIR, moduleName))
        const places = placesOf(moduleName)

        it('puts every file in a place the table names', () => {
            const misplaced = files.filter((file) =>
                isSpec(file) ? !specFolderAllowed(folderOf(file), files) : !places.some((place) => place.test(file))
            )
            expect(misplaced).toEqual([])
        })

        it('has an index.ts in the module, in every layer and in dto/', () => {
            const folders = new Set(files.map(folderOf))
            const needIndex = [
                '',
                ...['domain/', 'application/', 'infrastructure/', 'presentation/', 'presentation/http/dto/'].filter(
                    (folder) => [...folders].some((present) => present.startsWith(folder))
                )
            ]
            const missing = needIndex.filter((folder) => !files.includes(`${folder}index.ts`))
            expect(missing).toEqual([])
        })

        it('declares one class per DTO file, named after the file', () => {
            const wrong = files
                .filter((file) => /^presentation\/http\/dto\/[^/]+\.dto\.ts$/.test(file))
                .filter((file) => {
                    const classes = classesIn(read(moduleName, file))
                    const expected = squash(file.slice(file.lastIndexOf('/') + 1, -'.dto.ts'.length)) + 'dto'
                    return classes.length !== 1 || !classes[0].exported || squash(classes[0].name) !== expected
                })
            expect(wrong).toEqual([])
        })

        it('names each command and query after its folder', () => {
            const wrong = files
                .filter((file) => /^application\/(?:commands|queries)\/[^/]+\/[^/]+\.(?:command|query)\.ts$/.test(file))
                .filter((file) => {
                    const [, , folder, base] = file.split('/')
                    const kind = base.endsWith('.command.ts') ? 'command' : 'query'
                    const names = classesIn(read(moduleName, file))
                        .filter((declared) => declared.exported)
                        .map((declared) => squash(declared.name))
                    return !names.includes(squash(folder) + kind)
                })
            expect(wrong).toEqual([])
        })

        it('keeps each command and query folder to one form: a single pair, or the area pair', () => {
            const kindsByFolder = new Map<string, string[]>()
            for (const file of files) {
                const match = /^(application\/(?:commands|queries)\/[^/]+\/)[^/.]+\.([a-z]+)\.ts$/.exec(file)
                if (!match || isSpec(file)) continue
                kindsByFolder.set(match[1], [...(kindsByFolder.get(match[1]) ?? []), match[2]])
            }
            const forms = ['command,handler', 'commands,handlers', 'handler,query', 'handlers,queries']
            const wrong = [...kindsByFolder]
                .filter(([, kinds]) => !forms.includes([...kinds].sort().join(',')))
                .map(([folder]) => folder)
            expect(wrong).toEqual([])
        })

        it('declares DTO classes only in dto/', () => {
            const wrong = files
                .filter((file) => !isSpec(file) && file.endsWith('.ts') && !file.startsWith('presentation/http/dto/'))
                .filter((file) => classesIn(read(moduleName, file)).some((declared) => declared.name.endsWith('Dto')))
            expect(wrong).toEqual([])
        })
    })
})
