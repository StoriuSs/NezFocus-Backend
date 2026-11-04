// Turns the files in monitoring/ into what Grafana Cloud takes: alert rules,
// a notification configuration and dashboards, all narrowed to one project.
// The HTTP side is in ../monitoring-cloud-sync.ts. See docs/monitoring.md,
// "Grafana Cloud".

import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { load } from 'js-yaml'
import { scopeLogQL, scopePromQL, scopePrometheusVariable, type Matchers } from './query-scope'

export interface SyncOptions {
    /** Compose project name: the `project` label of this stack's data. */
    project: string
    /** development or production: the `environment` label. */
    environment: string
    /** The monitoring/ directory. */
    monitoringDir: string
    /** Where alerts are delivered; a file locally, inline in Grafana Cloud. */
    webhookUrl: string
    /** The dead man's switch, when there is one. */
    heartbeatUrl?: string
}

/**
 * Alerts about the local monitoring stack: in Grafana Cloud, Grafana watches
 * its own rule evaluation and notifications.
 */
export const LOCAL_ONLY_ALERTS = ['PrometheusRuleFailures', 'AlertmanagerNotificationsFailing']

export interface RuleGroup {
    name: string
    interval?: string
    rules: Record<string, unknown>[]
}

export interface RuleUpload {
    /** Which data source the rules query. */
    datasource: 'prometheus' | 'loki'
    group: RuleGroup
    /** Where the alerts of this group go. */
    notifications: NotificationSettings
    /** The file it came from, for messages. */
    source: string
}

function readYaml<T>(path: string): T {
    return load(readFileSync(path, 'utf8')) as T
}

function yamlFiles(dir: string): string[] {
    return readdirSync(dir)
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
        .map((name) => join(dir, name))
}

/**
 * The alert rules, with every query narrowed to this project and every rule
 * labelled with it: one Grafana Cloud stack can hold several projects, and a
 * rule's own labels are what a notification shows.
 */
export function buildRuleGroups(options: SyncOptions): RuleUpload[] {
    const matchers: Matchers = { project: options.project }
    const labels = { project: options.project, environment: options.environment }
    const uploads: RuleUpload[] = []

    const sources: { dir: string; datasource: 'prometheus' | 'loki' }[] = [
        { dir: join(options.monitoringDir, 'prometheus/rules'), datasource: 'prometheus' },
        { dir: join(options.monitoringDir, 'loki/rules'), datasource: 'loki' }
    ]

    const groups: { datasource: 'prometheus' | 'loki'; group: RuleGroup; source: string }[] = []
    for (const { dir, datasource } of sources) {
        for (const path of yamlFiles(dir)) {
            const file = readYaml<{ groups: RuleGroup[] }>(path)
            for (const group of file.groups ?? []) {
                const rules = group.rules
                    .filter((rule) => !LOCAL_ONLY_ALERTS.includes(String(rule.alert)))
                    .map((rule) => ({
                        ...rule,
                        expr:
                            datasource === 'loki'
                                ? scopeLogQL(String(rule.expr), matchers)
                                : scopePromQL(String(rule.expr), matchers),
                        labels: { ...((rule.labels as Record<string, string>) ?? {}), ...labels }
                    }))
                if (rules.length > 0) groups.push({ datasource, group: { ...group, rules }, source: basename(path) })
            }
        }
    }
    groups.push({ datasource: 'prometheus', group: metricsStoppedGroup(options), source: 'grafana-cloud' })

    // A group is uploaded with one destination, so rules of the same group that
    // route differently (the Watchdog among the monitoring alerts) become their
    // own group, named after the receiver.
    const notifications = buildNotifications(options)
    const routes = readYaml<{ route: Route }>(join(options.monitoringDir, 'alertmanager/alertmanager.yml')).route
    for (const { datasource, group, source } of groups) {
        const byRoute = new Map<string, { settings: NotificationSettings; rules: Record<string, unknown>[] }>()
        for (const rule of group.rules) {
            const settings = notificationsFor(rule, routes, options, notifications)
            const key = JSON.stringify(settings)
            const entry = byRoute.get(key) ?? { settings, rules: [] }
            entry.rules.push(rule)
            byRoute.set(key, entry)
        }
        for (const { settings, rules } of byRoute.values()) {
            // The group keeps its name for the alerts that go to the project's
            // contact point; the others say where they go instead.
            const suffix = settings.receiver.endsWith('-heartbeat')
                ? '-heartbeat'
                : settings.mute_time_intervals
                  ? '-muted'
                  : ''
            uploads.push({
                datasource,
                group: { ...group, name: `${group.name}${suffix}`, rules },
                notifications: settings,
                source
            })
        }
    }
    return uploads
}

/**
 * Where one rule's alerts go, by walking the routes of alertmanager.yml with
 * the labels the rule carries. A route whose receiver drops alerts (`none`)
 * becomes the default contact point plus a mute timing that always mutes:
 * Grafana has no receiver that discards.
 */
function notificationsFor(
    rule: Record<string, unknown>,
    routes: Route,
    options: SyncOptions,
    notifications: Notifications
): NotificationSettings {
    const labels = {
        alertname: String(rule.alert),
        ...((rule.labels as Record<string, string>) ?? {})
    }
    const route = routeFor(routes, labels)
    const heartbeat = notifications.contactPoints.find((point) => point.name.endsWith('-heartbeat'))
    const silent = route.receiver === 'none' || (route.receiver === 'heartbeat' && !heartbeat)
    return {
        receiver: route.receiver === 'heartbeat' && heartbeat ? heartbeat.name : options.project,
        group_by: route.group_by,
        group_wait: route.group_wait,
        group_interval: route.group_interval,
        repeat_interval: route.repeat_interval,
        ...(silent ? { mute_time_intervals: [notifications.muteTiming] } : {})
    }
}

/**
 * Locally, Prometheus and Alertmanager run beside the app, and the heartbeat
 * covers them going down with it. In Grafana Cloud, Alloy on the server is the
 * only thing sending: when it stops, every rule sees nothing at all, which no
 * other rule here reports.
 */
function metricsStoppedGroup(options: SyncOptions): RuleGroup {
    return {
        name: 'grafana-cloud',
        rules: [
            {
                alert: 'MetricsStopped',
                expr: `absent_over_time(up{job="alloy", project="${options.project}"}[10m])`,
                labels: { severity: 'critical', project: options.project, environment: options.environment },
                annotations: {
                    summary: 'No metrics are arriving',
                    description:
                        'Alloy has sent nothing for 10 minutes: it has stopped, the server is down, or its Grafana Cloud token no longer works. No other alert about this stack can fire meanwhile.'
                }
            }
        ]
    }
}

// ── Notifications ────────────────────────────────────────────────────────────
//
// Grafana Cloud has no Alertmanager configuration to load: alert rules name the
// contact point they notify ("simplified routing"), and there is no routing
// tree to walk at alert time. The routes in monitoring/alertmanager/alertmanager.yml
// match on labels each rule already has (alertname, severity, environment), so
// the route each rule would take is worked out here instead, once, and stored
// on the rule. Contact points, the template and the mute timing are created
// under this project's name, so other projects in the same stack are untouched.

interface Route {
    receiver?: string
    matchers?: string[]
    group_by?: string[]
    group_wait?: string
    group_interval?: string
    repeat_interval?: string
    routes?: Route[]
}

export interface NotificationSettings {
    receiver: string
    group_by?: string[]
    group_wait?: string
    group_interval?: string
    repeat_interval?: string
    mute_time_intervals?: string[]
}

/** A matcher of the `name="value"`, `name=~"a|b"`, `!=`, `!~` forms. */
function matches(matcher: string, labels: Record<string, string>): boolean {
    const parsed = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(=~|!~|!=|=)\s*"?(.*?)"?\s*$/.exec(matcher)
    if (!parsed) throw new Error(`Cannot read the matcher ${matcher} in alertmanager.yml`)
    const [, name, operator, value] = parsed
    const actual = labels[name] ?? ''
    switch (operator) {
        case '=':
            return actual === value
        case '!=':
            return actual !== value
        case '=~':
            return new RegExp(`^(?:${value})$`).test(actual)
        default:
            return !new RegExp(`^(?:${value})$`).test(actual)
    }
}

/** The route an alert with these labels takes: the first match wins, depth first. */
function routeFor(route: Route, labels: Record<string, string>, inherited: Route = {}): Route {
    const here = { ...inherited, ...route, routes: undefined }
    for (const child of route.routes ?? []) {
        if ((child.matchers ?? []).every((matcher) => matches(matcher, labels))) return routeFor(child, labels, here)
    }
    return here
}

export interface ContactPoint {
    name: string
    type: string
    settings: Record<string, string>
}

export interface Notifications {
    contactPoints: ContactPoint[]
    muteTiming: string
    template: { name: string; content: string }
}

/**
 * The contact point for the `notify` receiver of alertmanager.yml, of the same
 * kind: Discord as shipped, Slack or Teams once that receiver is switched
 * (docs/alerts.md), so alerts reach the same place in both modes. It used to
 * be Discord whatever the receiver was, and a Slack URL given to Grafana's
 * Discord integration delivered nothing.
 */
export function notifyContactPoint(options: SyncOptions): ContactPoint {
    const { receivers = [] } = readYaml<{ receivers?: ({ name: string } & Record<string, unknown>)[] }>(
        join(options.monitoringDir, 'alertmanager/alertmanager.yml')
    )
    const kinds = Object.keys(receivers.find((receiver) => receiver.name === 'notify') ?? {}).filter((key) =>
        key.endsWith('_configs')
    )
    const url = options.webhookUrl
    const title = `{{ template "${options.project}.title" . }}`
    const message = `{{ template "${options.project}.message" . }}`
    const byKind: Record<string, Omit<ContactPoint, 'name'>> = {
        discord_configs: { type: 'discord', settings: { url, title, message } },
        slack_configs: { type: 'slack', settings: { url, title, text: message } },
        msteamsv2_configs: { type: 'teams', settings: { url, title, message } },
        webhook_configs: { type: 'webhook', settings: { url, httpMethod: 'POST' } }
    }
    const kind = kinds.length === 1 ? byKind[kinds[0]] : undefined
    if (!kind) {
        throw new Error(
            `The notify receiver in alertmanager.yml uses ${kinds.join(', ') || 'no integration'}; ` +
                `monitoring:cloud-sync makes a Discord, Slack, Teams or webhook contact point from ALERT_WEBHOOK_URL. ` +
                `Create a contact point named "${options.project}" in Grafana Cloud yourself, then sync the rest with --only rules,dashboards.`
        )
    }
    return { name: options.project, ...kind }
}

/** The contact points, template and mute timing this project needs. */
export function buildNotifications(options: SyncOptions): Notifications {
    const templateName = `${options.project}-notify`
    const contactPoints: ContactPoint[] = [notifyContactPoint(options)]
    if (options.heartbeatUrl) {
        contactPoints.push({
            name: `${options.project}-heartbeat`,
            type: 'webhook',
            settings: { url: options.heartbeatUrl, httpMethod: 'POST' }
        })
    }

    // The template's own names are global in a Grafana stack: give them the
    // project's prefix, as everything else here has.
    const source = readFileSync(join(options.monitoringDir, 'alertmanager/templates/notify.tmpl'), 'utf8')
    const content = source
        .split('define "notify.')
        .join(`define "${options.project}.`)
        .split('template "notify.')
        .join(`template "${options.project}.`)

    return { contactPoints, muteTiming: `${options.project}-muted`, template: { name: templateName, content } }
}

/**
 * A uid Grafana accepts (40 characters at most) for a name made from the
 * project's. One that fits is used as it is; a longer one keeps its start and
 * ends with a hash of the whole name. Cutting at 40 gave the dashboards of a
 * project with a long name one and the same uid, so each upload replaced the
 * one before.
 */
export function grafanaUid(name: string): string {
    if (name.length <= 40) return name
    return `${name.slice(0, 31)}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}`
}

export interface DashboardUpload {
    uid: string
    title: string
    dashboard: Record<string, unknown>
}

export interface DataSourceUids {
    prometheus: string
    loki: string
}

/**
 * The dashboards, with the queries narrowed to this project, the data sources
 * pointed at the stack's, and their own uids and tags: several projects can
 * live in one Grafana Cloud stack, each with its own copy.
 */
export function buildDashboards(options: SyncOptions, uids: DataSourceUids): DashboardUpload[] {
    const matchers: Matchers = { project: options.project }
    const dir = join(options.monitoringDir, 'grafana/provisioning/dashboards')
    const uploads: DashboardUpload[] = []

    for (const name of readdirSync(dir)
        .filter((file) => file.endsWith('.json'))
        .sort()) {
        const dashboard = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>
        scopeDashboard(dashboard, matchers, uids, '')

        const uid = grafanaUid(`${options.project}-${String(dashboard.uid)}`)
        dashboard.uid = uid
        // The dashboards link to each other by tag; with one stack per project
        // those links must stay inside the project.
        dashboard.tags = ((dashboard.tags as string[]) ?? []).map((tag) => (tag === 'stack' ? options.project : tag))
        for (const link of (dashboard.links as Record<string, unknown>[]) ?? []) {
            link.tags = ((link.tags as string[]) ?? []).map((tag) => (tag === 'stack' ? options.project : tag))
        }
        dashboard.id = null
        uploads.push({ uid, title: String(dashboard.title), dashboard })
    }
    return uploads
}

/** Rewrites queries, variables and data source references, in place. */
function scopeDashboard(node: unknown, matchers: Matchers, uids: DataSourceUids, inherited: string): void {
    if (Array.isArray(node)) {
        for (const item of node) scopeDashboard(item, matchers, uids, inherited)
        return
    }
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>

    const datasource = record.datasource as { type?: string; uid?: string } | undefined
    let type = inherited
    if (datasource && typeof datasource === 'object' && datasource.type) {
        type = datasource.type
        if (datasource.uid === 'prometheus') datasource.uid = uids.prometheus
        else if (datasource.uid === 'loki') datasource.uid = uids.loki
    }

    if (typeof record.expr === 'string') {
        record.expr = type === 'loki' ? scopeLogQL(record.expr, matchers) : scopePromQL(record.expr, matchers)
    }

    // Template variables: `query` is a string for Prometheus, an object for Loki.
    if (record.type === 'query' && record.query !== undefined) {
        if (typeof record.query === 'string') {
            record.query = scopePrometheusVariable(record.query, matchers)
        } else if (record.query && typeof record.query === 'object') {
            const query = record.query as Record<string, unknown>
            if (typeof query.query === 'string') {
                query.query =
                    type === 'loki' ? scopeLogQL(query.query, matchers) : scopePrometheusVariable(query.query, matchers)
            }
            // A Loki label query with no selector reads every stream in the stack.
            if (type === 'loki' && typeof query.stream === 'string') {
                query.stream =
                    query.stream.trim() === '' ? `{${matcherText(matchers)}}` : scopeLogQL(query.stream, matchers)
            }
        }
    }

    for (const value of Object.values(record)) scopeDashboard(value, matchers, uids, type)
}

function matcherText(matchers: Matchers): string {
    return Object.entries(matchers)
        .map(([name, value]) => `${name}="${value}"`)
        .join(', ')
}
