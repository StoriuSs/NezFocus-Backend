import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { parse } from 'dotenv'
import {
    assignedKeys,
    checkEnv,
    composeFilePaths,
    composeVariables,
    deployScriptVariables,
    SCHEMA_KEYS,
    TOOL_KEYS
} from './env-check'

const root = resolve(__dirname, '../..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const composeFiles = composeFilePaths(root)
const externalKeys = [
    ...composeFiles.flatMap((path) => composeVariables(readFileSync(path, 'utf8'))),
    ...deployScriptVariables(read('deploy.sh')),
    ...TOOL_KEYS
]
const example = read('.env.example')

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : []
    })
}

const devEnv = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    DB_NAME: 'db',
    DB_USERNAME: 'u',
    DB_PASSWORD: 'p',
    JWT_SECRET: 'dev-only-secret-dev-only-secret-00',
    AUTH_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000'
}

describe('checkEnv', () => {
    it('never prints a rejected value', () => {
        const secret = 'your_password_Xy91!'
        const { errors } = checkEnv({
            ...devEnv,
            NODE_ENV: 'production',
            DB_PASSWORD: secret,
            JWT_SECRET: `${secret}-and-long-enough-to-pass`
        })
        expect(errors.length).toBeGreaterThan(0)
        expect(errors.join('\n')).not.toContain(secret)
    })
})

// The schema, the code, compose, deploy.sh and .env.example drift apart one
// forgotten line at a time: DB_POOL_* were read but never validated or
// documented, and APP_NAME and BASE_URL were missing from the schema.
describe('configuration stays in sync', () => {
    // process.env.X, process.env['X'], const { X } = process.env, a config
    // helper's env.X, and prisma.config's env('X').
    const readPatterns = [
        /process\.env\.([A-Z][A-Z0-9_]*)/g,
        /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
        /\benv\.([A-Z][A-Z0-9_]*)/g,
        /\benv\(['"]([A-Z][A-Z0-9_]*)['"]\)/g
    ]
    const keysReadIn = (content: string) => [
        ...readPatterns.flatMap((pattern) => [...content.matchAll(pattern)].map((m) => m[1])),
        ...[...content.matchAll(/\{([^}]*)\}\s*=\s*process\.env/g)].flatMap((m) =>
            m[1].split(',').map((part) => part.split(':')[0].trim())
        )
    ]
    // monitoring-cloud-sync configures a Grafana Cloud stack from an env file
    // given to it; those keys are not the app's configuration, and env-check
    // knows them through the compose files and TOOL_KEYS.
    const appReads = [
        ...sourceFiles(join(root, 'src'))
            .filter((file) => !file.includes('monitoring-cloud-sync'))
            .flatMap((file) => keysReadIn(readFileSync(file, 'utf8'))),
        ...keysReadIn(read('prisma.config.ts'))
    ]

    it('validates every environment variable the app reads', () => {
        expect(
            [...new Set(appReads)].filter((key) => key && !SCHEMA_KEYS.includes(key) && !TOOL_KEYS.includes(key))
        ).toEqual([])
    })

    it('documents in .env.example every schema key and every variable the production compose file and deploy.sh read', () => {
        const documented = assignedKeys(example, { includeCommented: true })
        expect(SCHEMA_KEYS.filter((key) => !documented.includes(key))).toEqual([])
        // Set by deploy.sh itself, or by compose (its project name), not by the env file.
        const setByDeploy = ['APP_TAG', 'RUN_MIGRATIONS', 'COMPOSE_PROJECT_NAME']
        const needed = [
            ...composeFiles
                .filter((path) => /prod/.test(path))
                .flatMap((path) => composeVariables(readFileSync(path, 'utf8'))),
            ...deployScriptVariables(read('deploy.sh'))
        ]
        expect(needed.filter((key) => !documented.includes(key) && !setByDeploy.includes(key))).toEqual([])
    })

    it('ships a .env.example that passes the check', () => {
        expect(checkEnv(parse(example), { declaredKeys: assignedKeys(example), externalKeys })).toEqual({
            errors: [],
            warnings: []
        })
    })
})
