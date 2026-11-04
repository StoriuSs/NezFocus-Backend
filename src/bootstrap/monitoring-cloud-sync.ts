// Puts this project's alert rules, notification configuration and dashboards
// into Grafana Cloud. Only needed with MONITORING=grafana-cloud; the local
// stack reads the same files from disk. See docs/monitoring.md, "Grafana Cloud".
//
//   pnpm monitoring:cloud-sync                  .env.production
//   pnpm monitoring:cloud-sync .env.development  another env file
//   pnpm monitoring:cloud-sync --dry-run         print what it would send
//   pnpm monitoring:cloud-sync --dump <dir>      write what it would send, and send nothing
//   pnpm monitoring:cloud-sync --only dashboards rules, notifications or dashboards
//   pnpm monitoring:cloud-sync --remove          delete everything it put there for this project
//
// Everything it uploads is named after the Compose project (hexagonal-auth-prod),
// and every query is narrowed to it, so one Grafana Cloud stack can hold
// several projects and environments.
//
// On a server without Node, run it from the release image:
//   docker compose --env-file .env.production -f docker-compose.prod.yaml \
//     run --rm --no-deps -v ./monitoring:/app/monitoring:ro \
//     app node dist/src/bootstrap/monitoring-cloud-sync.js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'
import { parse } from 'dotenv'
import { load } from 'js-yaml'
import {
    buildNotifications,
    buildDashboards,
    buildRuleGroups,
    grafanaUid,
    type DataSourceUids,
    type SyncOptions
} from './monitoring/cloud-sync'

interface Settings {
    grafanaUrl: string
    token: string
    sync: SyncOptions
    dryRun: boolean
    /** Delete this project's rules, dashboards and notification settings instead. */
    remove: boolean
    /** Where to write what would be sent, instead of sending it. */
    dumpDir?: string
    /** Which parts to send; all of them by default. */
    parts: Part[]
}

const PARTS = ['rules', 'notifications', 'dashboards'] as const
type Part = (typeof PARTS)[number]

class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly body: string,
        message: string
    ) {
        super(message)
    }
}

function fail(message: string): never {
    console.error(`✖ ${message}`)
    process.exit(1)
}

/** The env file's values, with the process environment on top. */
function readEnv(file: string): Record<string, string> {
    const path = resolve(process.cwd(), file)
    const fromFile = existsSync(path) ? parse(readFileSync(path, 'utf8')) : {}
    const merged: Record<string, string> = { ...fromFile }
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) merged[key] = value
    return merged
}

/** The Compose project name for this env file: its stack's `project` label. */
function projectName(envFile: string, env: Record<string, string>): string {
    if (env.COMPOSE_PROJECT_NAME) return env.COMPOSE_PROJECT_NAME
    const composeFile = /production/.test(basename(envFile)) ? 'docker-compose.prod.yaml' : 'docker-compose.dev.yaml'
    const path = resolve(process.cwd(), composeFile)
    if (!existsSync(path))
        fail(`Cannot tell which project this is: ${composeFile} is not here, and COMPOSE_PROJECT_NAME is not set.`)
    const name = /^name:\s*(\S+)/m.exec(readFileSync(path, 'utf8'))?.[1]
    return name ?? fail(`${composeFile} has no top-level name:, so the project name is unknown.`)
}

function settings(): Settings {
    const args = process.argv.slice(2)
    const dryRun = args.includes('--dry-run')
    const remove = args.includes('--remove')
    const dumpAt = args.indexOf('--dump')
    const dumpDir = dumpAt >= 0 ? args[dumpAt + 1] : undefined
    if (dumpAt >= 0 && !dumpDir) fail('--dump needs a directory.')
    const onlyAt = args.indexOf('--only')
    if (onlyAt >= 0 && !args[onlyAt + 1]) fail(`--only needs one or more of ${PARTS.join(', ')}.`)
    const parts = onlyAt >= 0 ? (args[onlyAt + 1].split(',') as Part[]) : [...PARTS]
    const unknown = parts.filter((part) => !PARTS.includes(part))
    if (unknown.length > 0) fail(`--only ${unknown.join(', ')}: expected ${PARTS.join(', ')}.`)
    const valueIndexes = new Set([dumpAt + 1, onlyAt + 1].filter((index) => index > 0))
    const envFile =
        args.filter((arg, index) => !arg.startsWith('--') && !valueIndexes.has(index))[0] ?? '.env.production'
    const env = readEnv(envFile)

    // Removing is what follows a switch back to local, so it doesn't ask for
    // grafana-cloud.
    if (!remove && (env.MONITORING ?? 'local') !== 'grafana-cloud') {
        fail(
            `MONITORING is "${env.MONITORING ?? 'local'}" in ${envFile}: this stack keeps its monitoring on the server, and has nothing to sync.`
        )
    }
    const required = [
        'GRAFANA_CLOUD_GRAFANA_URL',
        'GRAFANA_CLOUD_GRAFANA_TOKEN',
        ...(remove ? [] : ['ALERT_WEBHOOK_URL'])
    ]
    const missing = required.filter((key) => !env[key])
    if (missing.length > 0)
        fail(`${envFile} is missing ${missing.join(', ')}. See docs/monitoring.md, "Grafana Cloud".`)

    const environment = /production/.test(basename(envFile)) ? 'production' : 'development'
    return {
        grafanaUrl: env.GRAFANA_CLOUD_GRAFANA_URL.replace(/\/+$/, ''),
        token: env.GRAFANA_CLOUD_GRAFANA_TOKEN,
        dryRun,
        remove,
        dumpDir,
        parts,
        sync: {
            project: projectName(envFile, env),
            environment,
            monitoringDir: resolve(process.cwd(), 'monitoring'),
            webhookUrl: env.ALERT_WEBHOOK_URL ?? '',
            heartbeatUrl: env.ALERT_HEARTBEAT_URL || undefined
        }
    }
}

class Grafana {
    constructor(
        private readonly url: string,
        private readonly token: string
    ) {}

    async request(
        method: string,
        path: string,
        options: { body?: string; contentType?: string; headers?: Record<string, string> } = {}
    ) {
        const res = await fetch(this.url + path, {
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
                ...(options.headers ?? {})
            },
            body: options.body
        })
        const text = await res.text()
        if (!res.ok) {
            throw new HttpError(
                res.status,
                text,
                `${method} ${path} → ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`
            )
        }
        return text
    }

    async json<T>(
        method: string,
        path: string,
        options?: { body?: string; contentType?: string; headers?: Record<string, string> }
    ): Promise<T> {
        const text = await this.request(method, path, options)
        return (text ? JSON.parse(text) : {}) as T
    }
}

/** The stack's own Prometheus and Loki data sources. */
async function dataSources(grafana: Grafana): Promise<DataSourceUids> {
    const all = await grafana.json<{ uid: string; type: string; name: string }[]>('GET', '/api/datasources')
    const pick = (type: string, suffix: string) => {
        const found = all.filter((ds) => ds.type === type && ds.name.endsWith(suffix))
        if (found.length !== 1) {
            fail(
                `Expected one ${type} data source whose name ends with "${suffix}", found ${found.length}: ` +
                    all
                        .filter((ds) => ds.type === type)
                        .map((ds) => ds.name)
                        .join(', ')
            )
        }
        return found[0].uid
    }
    return { prometheus: pick('prometheus', '-prom'), loki: pick('loki', '-logs') }
}

/**
 * The folder this project's alert rules are in. Uploading rules creates it, so
 * it is read back from them: Grafana's folder list is a search index that lags
 * behind, and a folder created here but not yet listed made the rules import
 * create a second folder of the same name.
 */
async function folderOfRules(grafana: Grafana, project: string): Promise<string | undefined> {
    const rules = await grafana.json<{ folderUID: string; labels?: Record<string, string> }[]>(
        'GET',
        '/api/v1/provisioning/alert-rules'
    )
    return rules.find((rule) => rule.labels?.project === project)?.folderUID
}

/** That folder, or one created now when this run uploads no rules. */
async function folderUid(grafana: Grafana, project: string): Promise<string> {
    const fromRules = await folderOfRules(grafana, project)
    if (fromRules) return fromRules

    const folders = await grafana.json<{ uid: string; title: string }[]>('GET', '/api/folders?limit=1000')
    const existing = folders.find((folder) => folder.title === project)
    if (existing) return existing.uid

    const uid = grafanaUid(project)
    try {
        await grafana.request('POST', '/api/folders', {
            contentType: 'application/json',
            body: JSON.stringify({ uid, title: project })
        })
    } catch (error) {
        // 409/412: created in the meantime, which is what we want.
        if (!(error instanceof HttpError) || ![409, 412].includes(error.status)) throw error
    }
    return uid
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function syncRules(grafana: Grafana, settings: Settings, uids: DataSourceUids): Promise<string[]> {
    const namespace = encodeURIComponent(settings.sync.project)
    const uploads = buildRuleGroups(settings.sync)
    const done: string[] = []
    for (const upload of uploads) {
        // A folder Grafana has just created answers 404 here until its search
        // index has it.
        for (let attempt = 1; ; attempt++) {
            try {
                await grafana.request('POST', `/api/convert/prometheus/config/v1/rules/${namespace}`, {
                    contentType: 'application/json',
                    body: JSON.stringify(upload.group),
                    headers: {
                        'X-Grafana-Alerting-Datasource-UID': uids[upload.datasource],
                        'X-Grafana-Alerting-Notification-Settings': JSON.stringify(upload.notifications)
                    }
                })
                break
            } catch (error) {
                if (!(error instanceof HttpError) || error.status !== 404 || attempt === 10) throw error
                await sleep(3000)
            }
        }
        done.push(upload.group.name)
    }

    // Groups that were uploaded before and are gone from monitoring/ now.
    // This endpoint answers in YAML.
    const existing = load(
        await grafana.request('GET', `/api/convert/prometheus/config/v1/rules/${namespace}`)
    ) as Record<string, { name: string }[]>
    if (!existing) return done
    for (const group of existing[settings.sync.project] ?? []) {
        if (!done.includes(group.name)) {
            await grafana.request(
                'DELETE',
                `/api/convert/prometheus/config/v1/rules/${namespace}/${encodeURIComponent(group.name)}`
            )
            console.log(`  removed group ${group.name}, which monitoring/ no longer has`)
        }
    }
    return done
}

/**
 * The contact points, the message template and the mute timing this project's
 * rules name. Each is created or updated under the project's name, so other
 * projects in the same Grafana Cloud stack keep theirs.
 */
async function syncNotifications(grafana: Grafana, settings: Settings): Promise<string[]> {
    const { contactPoints, muteTiming, template } = buildNotifications(settings.sync)
    const json = { contentType: 'application/json', headers: { 'X-Disable-Provenance': 'true' } }

    await grafana.request('PUT', `/api/v1/provisioning/templates/${encodeURIComponent(template.name)}`, {
        ...json,
        body: JSON.stringify({ template: template.content })
    })

    const existing = await grafana.json<{ uid: string; name: string }[]>('GET', '/api/v1/provisioning/contact-points')
    for (const point of contactPoints) {
        const known = existing.find((candidate) => candidate.name === point.name)
        if (known) {
            await grafana.request('PUT', `/api/v1/provisioning/contact-points/${known.uid}`, {
                ...json,
                body: JSON.stringify({ ...point, uid: known.uid })
            })
        } else {
            await grafana.request('POST', '/api/v1/provisioning/contact-points', {
                ...json,
                body: JSON.stringify(point)
            })
        }
    }

    // A time interval with no restrictions matches always: Grafana has no
    // receiver that drops alerts, so the routes that drop them mute instead.
    const timing = { name: muteTiming, time_intervals: [{}] }
    try {
        await grafana.request('POST', '/api/v1/provisioning/mute-timings', { ...json, body: JSON.stringify(timing) })
    } catch (error) {
        if (!(error instanceof HttpError) || ![400, 409].includes(error.status)) throw error
        await grafana.request('PUT', `/api/v1/provisioning/mute-timings/${encodeURIComponent(muteTiming)}`, {
            ...json,
            body: JSON.stringify(timing)
        })
    }
    return contactPoints.map((point) => point.name)
}

async function syncDashboards(
    grafana: Grafana,
    settings: Settings,
    uids: DataSourceUids,
    folder: string
): Promise<string[]> {
    const uploaded: string[] = []
    for (const dashboard of buildDashboards(settings.sync, uids)) {
        await grafana.request('POST', '/api/dashboards/db', {
            contentType: 'application/json',
            body: JSON.stringify({
                dashboard: dashboard.dashboard,
                folderUid: folder,
                overwrite: true,
                message: 'monitoring:cloud-sync'
            })
        })
        uploaded.push(dashboard.title)
    }
    return uploaded
}

/**
 * Deletes what the sync put in Grafana Cloud for this project: its folder (the
 * rules and dashboards in it), then the contact points, template and mute
 * timing, which Grafana refuses to delete while a rule names them. Left in
 * place after a switch back to local, the rules would see no data and send
 * MetricsStopped.
 */
async function removeProject(grafana: Grafana, settings: Settings): Promise<void> {
    const { project } = settings.sync
    const { contactPoints, muteTiming, template } = buildNotifications(settings.sync)
    const pointNames = new Set([project, `${project}-heartbeat`, ...contactPoints.map((point) => point.name)])

    // By the rules' folder, and by title: the folder list lags behind.
    const folders = new Set<string>()
    const fromRules = await folderOfRules(grafana, project)
    if (fromRules) folders.add(fromRules)
    const listed = await grafana.json<{ uid: string; title: string }[]>('GET', '/api/folders?limit=1000')
    for (const folder of listed) if (folder.title === project) folders.add(folder.uid)

    const points = (
        await grafana.json<{ uid: string; name: string }[]>('GET', '/api/v1/provisioning/contact-points')
    ).filter((point) => pointNames.has(point.name))

    // Grafana answers these two deletes with success whether or not they exist.
    const hasTemplate = (await grafana.json<{ name: string }[]>('GET', '/api/v1/provisioning/templates')).some(
        (candidate) => candidate.name === template.name
    )
    const hasMuteTiming = (await grafana.json<{ name: string }[]>('GET', '/api/v1/provisioning/mute-timings')).some(
        (candidate) => candidate.name === muteTiming
    )

    const steps: [string, string][] = [
        ...[...folders].map((uid): [string, string] => [
            `folder ${project} (${uid}), with its rules and dashboards`,
            `/api/folders/${encodeURIComponent(uid)}?forceDeleteRules=true`
        ]),
        ...points.map((point): [string, string] => [
            `contact point ${point.name}`,
            `/api/v1/provisioning/contact-points/${point.uid}`
        ]),
        ...(hasTemplate
            ? [
                  [
                      `message template ${template.name}`,
                      `/api/v1/provisioning/templates/${encodeURIComponent(template.name)}`
                  ] as [string, string]
              ]
            : []),
        ...(hasMuteTiming
            ? [
                  [
                      `mute timing ${muteTiming}`,
                      `/api/v1/provisioning/mute-timings/${encodeURIComponent(muteTiming)}`
                  ] as [string, string]
              ]
            : [])
    ]
    if (steps.length === 0) console.log(`  Grafana Cloud has nothing of ${project}.`)

    for (const [what, path] of steps) {
        if (settings.dryRun) {
            console.log(`  would delete ${what}`)
            continue
        }
        try {
            await grafana.request('DELETE', path)
            console.log(`  deleted ${what}`)
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 404) throw error
            console.log(`  ${what}: not there`)
        }
    }
}

async function main(): Promise<number> {
    const config = settings()
    const { project, environment } = config.sync
    console.log(`Grafana Cloud sync for ${project} (${environment}) → ${config.grafanaUrl}`)

    if (config.remove) {
        await removeProject(new Grafana(config.grafanaUrl, config.token), config)
        console.log(config.dryRun ? 'Nothing was deleted (--dry-run).' : `Done. Nothing of ${project} is left.`)
        return 0
    }

    if (config.dumpDir) {
        const dir = resolve(process.cwd(), config.dumpDir)
        mkdirSync(join(dir, 'rules'), { recursive: true })
        mkdirSync(join(dir, 'dashboards'), { recursive: true })
        for (const upload of buildRuleGroups(config.sync)) {
            writeFileSync(
                join(dir, 'rules', `${upload.datasource}-${upload.group.name}.json`),
                JSON.stringify(upload.group, null, 2)
            )
        }
        writeFileSync(join(dir, 'notifications.json'), JSON.stringify(buildNotifications(config.sync), null, 2))
        for (const dashboard of buildDashboards(config.sync, { prometheus: '<prometheus>', loki: '<loki>' })) {
            writeFileSync(
                join(dir, 'dashboards', `${dashboard.uid}.json`),
                JSON.stringify(dashboard.dashboard, null, 2)
            )
        }
        console.log(`Written to ${dir}. Nothing was sent (--dump).`)
        return 0
    }

    if (config.dryRun) {
        const rules = buildRuleGroups(config.sync)
        console.log(`  ${rules.length} rule groups: ${rules.map((r) => r.group.name).join(', ')}`)
        console.log(`  ${rules.reduce((n, r) => n + r.group.rules.length, 0)} alert rules`)
        const dashboards = buildDashboards(config.sync, { prometheus: '<prometheus>', loki: '<loki>' })
        console.log(`  ${dashboards.length} dashboards: ${dashboards.map((d) => d.title).join(', ')}`)
        const notifications = buildNotifications(config.sync)
        console.log(
            `  contact points: ${notifications.contactPoints.map((point) => `${point.name} (${point.type})`).join(', ')}`
        )
        console.log('Nothing was sent (--dry-run).')
        return 0
    }

    const grafana = new Grafana(config.grafanaUrl, config.token)
    const uids = await dataSources(grafana)
    console.log(`  data sources: ${uids.prometheus}, ${uids.loki}`)

    // The contact points first: a rule names the one it notifies, and Grafana
    // refuses a rule whose contact point isn't there yet.
    if (config.parts.includes('notifications')) {
        const points = await syncNotifications(grafana, config)
        console.log(`  contact points and message template: ${points.join(', ')}`)
    }

    if (config.parts.includes('rules')) {
        const groups = await syncRules(grafana, config, uids)
        console.log(`  ${groups.length} rule groups`)
    }

    if (config.parts.includes('dashboards')) {
        const folder = await folderUid(grafana, project)
        const dashboards = await syncDashboards(grafana, config, uids, folder)
        console.log(`  ${dashboards.length} dashboards in folder ${project}`)
    }

    console.log(`Done. Grafana Cloud → Alerting → Alert rules, and Dashboards → ${project}.`)
    return 0
}

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 403) {
            fail(`${error.message}\n  The service account token needs the Admin role for this; see docs/monitoring.md.`)
        }
        fail(error instanceof Error ? error.message : String(error))
    })
