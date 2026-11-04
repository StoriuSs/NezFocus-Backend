import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { validationSchema } from './validation'

/**
 * Checks an environment against the configuration schema, and an env file's
 * keys against what actually reads them. Used by `pnpm env:check` and by
 * deploy.sh, which runs it inside the release image before migrating.
 *
 * The app validates its configuration at boot too, but only by then failing to
 * start, and it says nothing about keys nobody reads — a misspelled optional
 * key (THROTLE_LIMIT) silently leaves the default in force.
 */

export interface EnvReport {
    errors: string[]
    warnings: string[]
}

export interface CheckEnvOptions {
    /** Keys assigned in the env file, in order, duplicates included. */
    declaredKeys?: string[]
    /** Keys read outside the app: compose interpolation, deploy.sh. */
    externalKeys?: Iterable<string>
    /** Keys the compose file sets for the app itself, overriding the env file. */
    overriddenKeys?: Iterable<string>
    /** Keys whose value holds a `$` outside single quotes. */
    dollarKeys?: Iterable<string>
    /**
     * Keys whose real value comes from somewhere else (the compose file, when
     * an env file is checked on its own): their errors are about a value the
     * app never gets, so they are left out.
     */
    valuesSetElsewhere?: Iterable<string>
}

const KEY = '[A-Za-z_][A-Za-z0-9_]*'

/** Every key the configuration schema declares. */
export const SCHEMA_KEYS: readonly string[] = Object.keys(validationSchema.describe().keys ?? {})

/**
 * Keys assigned in env file content, in order and including duplicates:
 * `KEY=value`, `export KEY=value`, and `KEY: value`, which dotenv and compose
 * both accept. With `includeCommented`, `# KEY=value` lines count too: in
 * .env.example a commented line documents an optional setting.
 */
export function assignedKeys(content: string, { includeCommented = false } = {}): string[] {
    const assigned = new RegExp(`^\\s*(?:export\\s+)?(${KEY})\\s*(?:=|:\\s)`)
    const commented = new RegExp(`^\\s*#\\s*(?:export\\s+)?(${KEY})\\s*=`)
    return content
        .split(/\r?\n/)
        .map((text) => assigned.exec(text)?.[1] ?? (includeCommented ? commented.exec(text)?.[1] : undefined))
        .filter((key): key is string => key !== undefined)
}

/**
 * Keys whose value contains a `$` outside single quotes, not escaped as `$$`.
 * docker compose substitutes `$NAME` in env files: `aB3$kL9` becomes `aB3`
 * there, while dotenv (and so this check, locally) keeps it as written.
 */
export function dollarKeys(content: string): string[] {
    const line = new RegExp(`^\\s*(?:export\\s+)?(${KEY})\\s*=\\s*(.*)$`)
    return unique(
        content
            .split(/\r?\n/)
            .map((text) => line.exec(text))
            .filter(
                (match): match is RegExpExecArray =>
                    match !== null && !match[2].startsWith("'") && match[2].split('$$').join('').includes('$')
            )
            .map((match) => match[1])
    )
}

/**
 * Content without `#` comments (YAML and shell): a commented-out line still
 * contains `${NAME}`, but reads nothing.
 */
function withoutComments(content: string): string {
    return content.replace(/(^|\s)#.*$/gm, '$1')
}

/**
 * Every compose file of the project at `dir`: the ones beside it, and the
 * monitoring files they include (one per MONITORING value, only one of which
 * is used at a time — but a key either of them reads is read by this project).
 */
export function composeFilePaths(dir: string): string[] {
    const here = readdirSync(dir)
        .filter((name) => /^docker-compose.*\.ya?ml$/.test(name))
        .map((name) => join(dir, name))
    const includedDir = join(dir, 'monitoring/compose')
    const included = existsSync(includedDir)
        ? readdirSync(includedDir)
              .filter((name) => /\.ya?ml$/.test(name))
              .map((name) => join(includedDir, name))
        : []
    return [...here, ...included].sort()
}

/**
 * Keys read by the tooling in this repository rather than by the app, the
 * compose files or deploy.sh: `pnpm monitoring:cloud-sync` uses the first two
 * to reach the Grafana of a Grafana Cloud stack, `pnpm prisma:check` the next
 * (prisma.config.ts), and `pnpm load:accounts` the LOAD_* keys the k6 scripts
 * also read.
 */
export const TOOL_KEYS: readonly string[] = [
    'GRAFANA_CLOUD_GRAFANA_URL',
    'GRAFANA_CLOUD_GRAFANA_TOKEN',
    'SHADOW_DATABASE_URL',
    'LOAD_EMAIL',
    'LOAD_PASSWORD',
    'LOAD_USER_COUNT'
]

/** Variables a compose file interpolates: `${NAME}`, `${NAME:-default}`, `${NAME:?message}`. */
export function composeVariables(content: string): string[] {
    return unique([...withoutComments(content).matchAll(new RegExp(`\\$\\{(${KEY})`, 'g'))].map((match) => match[1]))
}

/**
 * Keys a compose service sets in its own `environment:` block (map or list
 * form). They override the same keys from `env_file`. Reads the layout the
 * compose files here use: services at two spaces, their keys at four.
 */
export function serviceEnvironmentKeys(content: string, service: string): string[] {
    const keys: string[] = []
    let inServices = false
    let current = ''
    let inEnvironment = false
    for (const line of withoutComments(content).split(/\r?\n/)) {
        if (/^\S/.test(line)) {
            inServices = /^services:/.test(line)
            current = ''
            inEnvironment = false
            continue
        }
        const serviceName = inServices ? /^ {2}([\w.-]+):\s*$/.exec(line) : null
        if (serviceName) {
            current = serviceName[1]
            inEnvironment = false
            continue
        }
        if (current !== service) continue
        if (/^ {4}environment:\s*$/.test(line)) {
            inEnvironment = true
            continue
        }
        if (/^ {4}\S/.test(line)) inEnvironment = false
        if (!inEnvironment) continue
        const entry = new RegExp(`^ {6}(?:- )?(${KEY})\\s*[:=]`).exec(line)
        if (entry) keys.push(entry[1])
    }
    return unique(keys)
}

/** Settings deploy.sh reads from the env file (`env_value NAME default`). */
export function deployScriptVariables(content: string): string[] {
    return unique(
        [...withoutComments(content).matchAll(new RegExp(`\\benv_value[ \\t]+(${KEY})`, 'g'))].map((match) => match[1])
    )
}

export function checkEnv(env: Record<string, string | undefined>, options: CheckEnvOptions = {}): EnvReport {
    const errors: string[] = []
    const warnings: string[] = []

    const elsewhere = new Set(options.valuesSetElsewhere ?? [])
    const { error } = validationSchema.validate(env, { abortEarly: false, allowUnknown: true })
    for (const detail of error?.details ?? []) {
        if (elsewhere.has(String(detail.context?.key))) continue
        errors.push(redact(detail.message, detail.context?.value, detail.context?.label))
    }

    const declared = options.declaredKeys ?? []
    const counts = new Map<string, number>()
    for (const key of declared) counts.set(key, (counts.get(key) ?? 0) + 1)

    for (const [key, count] of counts) {
        if (count > 1) warnings.push(`${key} is set ${count} times; only the last one takes effect`)
    }

    const external = new Set(options.externalKeys ?? [])
    const overridden = new Set(options.overriddenKeys ?? [])
    const known = new Set([...SCHEMA_KEYS, ...external])
    // A key compose sets for the app but also interpolates (PORT: the host side
    // of the port mapping) still does something; the others are dead values.
    const ignored = [...counts.keys()].filter((key) => overridden.has(key) && !external.has(key))
    if (ignored.length > 0) {
        warnings.push(
            `Ignored by the app, because the compose file sets them for the app service itself: ${ignored.sort().join(', ')}`
        )
    }
    for (const key of counts.keys()) {
        if (known.has(key) || overridden.has(key)) continue
        const suggestion = closest(key, known)
        warnings.push(
            `${key} is not read by the app, docker compose or deploy.sh, so it has no effect` +
                (suggestion ? ` (did you mean ${suggestion}?)` : '')
        )
    }

    for (const key of options.dollarKeys ?? []) {
        warnings.push(
            `${key} contains "$", which docker compose reads as a variable ($NAME is replaced, usually by nothing). ` +
                `Put the value in single quotes, or write each $ as $$`
        )
    }

    return { errors, warnings }
}

/**
 * Joi quotes some offending values in its messages; secrets must not reach a
 * terminal or CI log. The label at the start of the message is left alone, so
 * a value that happens to occur in the key's name doesn't garble it.
 */
export function redact(message: string, value: unknown, label?: unknown): string {
    if (typeof value !== 'string' || value.length === 0) return message
    const prefix = typeof label === 'string' && message.startsWith(`"${label}"`) ? `"${label}"` : ''
    return prefix + message.slice(prefix.length).split(value).join('***')
}

/** The closest known key within edit distance 2, ignoring case. */
function closest(key: string, candidates: Iterable<string>): string | undefined {
    let best: string | undefined
    let bestDistance = 3
    for (const candidate of candidates) {
        const distance = editDistance(key.toUpperCase(), candidate.toUpperCase())
        if (distance < bestDistance) {
            best = candidate
            bestDistance = distance
        }
    }
    return best
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const current = [i]
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            )
        }
        previous = current
    }
    return previous[b.length]
}

function unique(values: string[]): string[] {
    return [...new Set(values)]
}
