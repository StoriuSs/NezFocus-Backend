// Narrows PromQL and LogQL queries to one project, for `pnpm monitoring:cloud-sync`.
//
// A Grafana Cloud stack can hold several projects and environments (each one's
// series and streams carry `project` and `environment` labels). The alert rules
// and dashboards in monitoring/ are written for one stack alone; before they are
// uploaded, every selector gets matchers for the project that uploads them.
//
// Not a full parser: it knows enough of PromQL (and of LogQL's stream selectors)
// for the queries in this repository, and Grafana's $variables in them.
// query-scope.spec.ts covers the rewriting, query by query.

export type Matchers = Record<string, string>

const IDENT_START = /[A-Za-z_:]/
const IDENT_PART = /[A-Za-z0-9_:]/

/** PromQL words that are never metric names. */
const KEYWORDS = new Set([
    'by',
    'without',
    'on',
    'ignoring',
    'group_left',
    'group_right',
    'bool',
    'and',
    'or',
    'unless',
    'offset',
    'inf',
    'nan',
    'atan2',
    // aggregation operators: `sum by (x) (...)` puts no "(" right after the name
    'sum',
    'min',
    'max',
    'avg',
    'group',
    'stddev',
    'stdvar',
    'count',
    'count_values',
    'bottomk',
    'topk',
    'quantile',
    'limitk',
    'limit_ratio'
])

/** Keywords followed by a parenthesised list of label names, not an expression. */
const LABEL_LIST_KEYWORDS = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right'])

export function formatMatchers(matchers: Matchers): string {
    return Object.entries(matchers)
        .map(([name, value]) => `${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
        .join(', ')
}

/** Index just past the string literal starting at `start`. */
function skipString(query: string, start: number): number {
    const quote = query[start]
    let i = start + 1
    while (i < query.length) {
        if (query[i] === '\\' && quote !== '`') {
            i += 2
            continue
        }
        if (query[i] === quote) return i + 1
        i++
    }
    throw new Error(`Unterminated string in query: ${query}`)
}

/** Index of the character closing the bracket at `start`, skipping strings. */
function matchingClose(query: string, start: number): number {
    const open = query[start]
    const close = open === '{' ? '}' : open === '[' ? ']' : ')'
    let depth = 0
    let i = start
    while (i < query.length) {
        const c = query[i]
        if (c === '"' || c === "'" || c === '`') {
            i = skipString(query, i)
            continue
        }
        if (c === open) depth++
        else if (c === close && --depth === 0) return i
        i++
    }
    throw new Error(`Unbalanced "${open}" in query: ${query}`)
}

/** Index just past a Grafana variable ($name, ${name}, [[name]] is not used here) at `start`. */
function skipVariable(query: string, start: number): number {
    if (query[start + 1] === '{') return matchingClose(query, start + 1) + 1
    let i = start + 1
    while (i < query.length && IDENT_PART.test(query[i])) i++
    return i
}

function nextNonSpace(query: string, from: number): number {
    let i = from
    while (i < query.length && /\s/.test(query[i])) i++
    return i
}

/** Inserts `matchers` at the start of the `{...}` block that opens at `open`. */
function insertIntoBraces(query: string, open: number, matchers: string): { query: string; end: number } {
    const close = matchingClose(query, open)
    const inner = query.slice(open + 1, close)
    const replaced = inner.trim() === '' ? matchers : `${matchers}, ${inner.replace(/^\s+/, '')}`
    const result = query.slice(0, open + 1) + replaced + query.slice(close)
    return { query: result, end: open + 1 + replaced.length + 1 }
}

/** Adds `matchers` to every vector selector of a PromQL expression. */
export function scopePromQL(expr: string, matchers: Matchers): string {
    const m = formatMatchers(matchers)
    let query = expr
    let i = 0
    let previousWord = ''
    while (i < query.length) {
        const c = query[i]
        if (c === '"' || c === "'" || c === '`') {
            i = skipString(query, i)
            previousWord = ''
            continue
        }
        if (c === '$') {
            i = skipVariable(query, i)
            previousWord = ''
            continue
        }
        if (c === '[') {
            i = matchingClose(query, i) + 1
            continue
        }
        if (c === '{') {
            // A selector without a metric name: {__name__="x"} or {job="y"}.
            const r = insertIntoBraces(query, i, m)
            query = r.query
            i = r.end
            previousWord = ''
            continue
        }
        if (c === '(' && LABEL_LIST_KEYWORDS.has(previousWord)) {
            i = matchingClose(query, i) + 1
            previousWord = ''
            continue
        }
        if (/[0-9.]/.test(c)) {
            // A number or a duration (5m, 1e3, 0x1f, .5)
            while (i < query.length && /[0-9A-Za-z_.]/.test(query[i])) i++
            previousWord = ''
            continue
        }
        if (IDENT_START.test(c)) {
            let end = i
            while (end < query.length && IDENT_PART.test(query[end])) end++
            const word = query.slice(i, end)
            const after = nextNonSpace(query, end)
            const lower = word.toLowerCase()
            if (KEYWORDS.has(lower) || query[after] === '(') {
                previousWord = lower
                i = end
                continue
            }
            // A metric name.
            if (query[after] === '{') {
                const r = insertIntoBraces(query, after, m)
                query = r.query
                i = r.end
            } else {
                query = `${query.slice(0, end)}{${m}}${query.slice(end)}`
                i = end + m.length + 2
            }
            previousWord = ''
            continue
        }
        if (!/\s/.test(c)) previousWord = ''
        i++
    }
    return query
}

/** Adds `matchers` to every stream selector of a LogQL query. */
export function scopeLogQL(expr: string, matchers: Matchers): string {
    const m = formatMatchers(matchers)
    let query = expr
    let i = 0
    while (i < query.length) {
        const c = query[i]
        if (c === '"' || c === "'" || c === '`') {
            i = skipString(query, i)
        } else if (c === '$') {
            i = skipVariable(query, i)
        } else if (c === '[') {
            i = matchingClose(query, i) + 1
        } else if (c === '{') {
            const r = insertIntoBraces(query, i, m)
            query = r.query
            i = r.end
        } else {
            i++
        }
    }
    return query
}

/**
 * Grafana's `label_values(metric, label)` variable query: only the first
 * argument is a selector. Other queries are PromQL.
 */
export function scopePrometheusVariable(query: string, matchers: Matchers): string {
    const match = /^\s*label_values\(\s*([\s\S]*?)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/.exec(query)
    if (match) return `label_values(${scopePromQL(match[1], matchers)}, ${match[2]})`
    const labelOnly = /^\s*label_values\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/.exec(query)
    if (labelOnly) return `label_values({${formatMatchers(matchers)}}, ${labelOnly[1]})`
    return scopePromQL(query, matchers)
}
