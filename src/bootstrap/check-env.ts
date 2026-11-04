// Checks env files against the configuration schema. See docs/environment.md.
//
//   pnpm env:check                        .env.development
//   pnpm env:check .env.production        any files
//
// A file whose name contains "production" is checked the way the production
// compose file runs the app: with the production rules, and knowing which keys
// that compose file sets for the app itself. Other files are checked with the
// NODE_ENV they set (development by default).
//
// Reports every invalid or missing value (the app stops at the first), keys
// that nothing reads — usually a typo, which leaves the default in force —,
// keys set twice, keys the compose file overrides, and values with a "$" that
// docker compose would substitute. Exits 1 when a value is invalid; the rest
// only warn.
//
// deploy.sh runs it inside the release image, against the environment compose
// gives the app, before migrating. It passes key names only, never values:
//
//   node dist/src/bootstrap/check-env.js --process-env --declared "<keys in the env file>"
//     --external "<keys read outside the app>" --overridden "<keys compose sets for the app>"
//     --dollar "<keys whose value has a $>"
import { existsSync, readFileSync } from 'fs'
import { basename, resolve } from 'path'
import { parse } from 'dotenv'
import {
    assignedKeys,
    checkEnv,
    composeFilePaths,
    composeVariables,
    deployScriptVariables,
    dollarKeys,
    type EnvReport,
    serviceEnvironmentKeys,
    TOOL_KEYS
} from '../config/env-check'

const APP_SERVICE = 'app'

function main(): number {
    const args = process.argv.slice(2)

    if (args.includes('--process-env')) {
        const report = checkEnv(process.env, {
            declaredKeys: words(option(args, '--declared')),
            externalKeys: words(option(args, '--external')),
            overriddenKeys: words(option(args, '--overridden')),
            dollarKeys: words(option(args, '--dollar'))
        })
        return print('Environment', report) ? 0 : 1
    }

    const files = args.filter((arg) => !arg.startsWith('--'))
    let valid = true
    for (const file of files.length > 0 ? files : ['.env.development']) {
        const path = resolve(process.cwd(), file)
        if (!existsSync(path)) {
            console.error(`✗ ${file}: not found (copy .env.example)`)
            valid = false
            continue
        }
        const content = readFileSync(path, 'utf8')
        const env = parse(content)
        const production = basename(file).includes('production')
        const nodeEnv = production ? 'production' : (env.NODE_ENV ?? 'development')
        const composeFile = production ? 'docker-compose.prod.yaml' : 'docker-compose.dev.yaml'
        const overridden = overriddenKeys(composeFile)
        const report = checkEnv(
            { ...env, NODE_ENV: nodeEnv },
            {
                declaredKeys: assignedKeys(content),
                externalKeys: externalKeys(),
                overriddenKeys: overridden,
                dollarKeys: dollarKeys(content),
                // Compose gives the app its own values for these; deploy.sh
                // checks those, inside the image.
                valuesSetElsewhere: overridden
            }
        )
        valid = print(`${file} (NODE_ENV=${nodeEnv})`, report) && valid
    }
    return valid ? 0 : 1
}

/** Keys read by the compose files and deploy.sh next to this project. */
function externalKeys(): string[] {
    const dir = process.cwd()
    const keys = composeFilePaths(dir).flatMap((path) => composeVariables(readFileSync(path, 'utf8')))
    const deployScript = resolve(dir, 'deploy.sh')
    if (existsSync(deployScript)) keys.push(...deployScriptVariables(readFileSync(deployScript, 'utf8')))
    return [...keys, ...TOOL_KEYS]
}

/**
 * Keys the compose file sets in the app service's own environment block. Only
 * for production: the development file is also read directly by `pnpm dev`,
 * where those values do matter.
 */
function overriddenKeys(composeFile: string): string[] {
    if (composeFile !== 'docker-compose.prod.yaml') return []
    const path = resolve(process.cwd(), composeFile)
    return existsSync(path) ? serviceEnvironmentKeys(readFileSync(path, 'utf8'), APP_SERVICE) : []
}

/** Prints a report; returns false when it has errors. */
function print(title: string, { errors, warnings }: EnvReport): boolean {
    if (errors.length === 0 && warnings.length === 0) {
        console.log(`✓ ${title}: OK`)
        return true
    }
    console.log(`${errors.length > 0 ? '✗' : '⚠'} ${title}`)
    for (const error of errors) console.log(`    ✗ ${error}`)
    for (const warning of warnings) console.log(`    ⚠ ${warning}`)
    return errors.length === 0
}

function option(args: string[], name: string): string {
    const index = args.indexOf(name)
    return index >= 0 ? (args[index + 1] ?? '') : ''
}

function words(value: string): string[] {
    return value.split(/\s+/).filter(Boolean)
}

process.exit(main())
