#!/usr/bin/env node
// coverage-changed: the tests related to the change, then the share of changed
// lines in domain/ and application/ that those tests run (CONSTRAINTS.md).
//
//   node scripts/constraints/coverage-changed.mjs [--base <ref>] [--lcov <file>]
//
//   default        run the unit tests related to the changed files under src/,
//                  collecting coverage of the changed domain/application files only
//   --lcov <file>  read an lcov report a test run already wrote (CI) instead
//
// Only lines the coverage report calls executable count: a blank line, a type
// or an import is neither covered nor uncovered.
//
// On a learn/* branch the share is reported, not enforced: the tests there are
// the originals and grade the rewrite by passing (docs/WORKFLOW.md, B3). The
// tests themselves must still pass.
//
// Exit 0 passed, 1 a test failed or the share is under the bar, 2 the check could not run.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { bail, goToTop, onLearnBranch, option, readChange, resolveBase, touchedFiles } from './change.mjs'

const TOOL = 'coverage-changed'
const MIN_PERCENT = 80
// Where the business rules live. Repositories and controllers are exercised by
// the integration and e2e suites, which this quick check does not run.
const MEASURED = /^src\/(modules\/[^/]+|shared)\/(domain|application)\/.*\.ts$/
const isSpec = (f) => /[.-]spec\.ts$/.test(f)

goToTop(TOOL)
const learn = onLearnBranch()
const change = readChange(TOOL, { base: resolveBase(TOOL) })
const measured = touchedFiles(change).filter((f) => MEASURED.test(f) && !isSpec(f))

let lcovFile = option('--lcov')
if (!lcovFile) {
    const sources = touchedFiles(change).filter((f) => /^src\/.*\.ts$/.test(f))
    if (!sources.length) {
        console.log(`${TOOL}: no changed files under src/`)
        process.exit(0)
    }
    lcovFile = 'coverage/changed/lcov.info'
    const coverageArgs = measured.length
        ? [
              '--coverage',
              ...measured.map((f) => `--collectCoverageFrom=${f}`),
              '--coverageReporters=lcov',
              '--coverageReporters=text-summary',
              '--coverageDirectory=coverage/changed'
          ]
        : []
    const run = spawnSync(
        process.execPath,
        [
            'node_modules/jest/bin/jest.js',
            '--findRelatedTests',
            ...sources.map((f) => resolve(f)),
            '--passWithNoTests',
            '--verbose=false',
            // Two workers keep this under a few hundred MB per worker on a
            // laptop that is also running Docker and an editor.
            '--maxWorkers=2',
            ...coverageArgs
        ],
        { stdio: 'inherit' }
    )
    if (run.status !== 0) {
        console.error(`${TOOL}: the related tests did not pass`)
        process.exit(run.status === null ? 2 : 1)
    }
    if (!measured.length) {
        console.log(`${TOOL}: tests passed; no changed lines in domain/ or application/ to measure`)
        process.exit(0)
    }
}

if (!existsSync(lcovFile)) bail(TOOL, `no coverage report at ${lcovFile}`)

// lcov: SF:<path> starts a file, DA:<line>,<hits> is one executable line.
const hits = new Map()
let current = null
for (const text of readFileSync(lcovFile, 'utf8').split(/\r?\n/)) {
    if (text.startsWith('SF:')) {
        current = new Map()
        hits.set(relative(process.cwd(), resolve(text.slice(3))).replaceAll('\\', '/'), current)
    } else if (text.startsWith('DA:') && current) {
        const [line, count] = text.slice(3).split(',').map(Number)
        current.set(line, count)
    }
}

let total = 0
let covered = 0
const missed = []
for (const file of measured) {
    const lines = hits.get(file)
    if (!lines) continue // nothing executable in it (types, interfaces)
    const uncovered = []
    for (const { line } of change.added.filter((a) => a.file === file)) {
        if (!lines.has(line)) continue
        total++
        if (lines.get(line) > 0) covered++
        else uncovered.push(line)
    }
    if (uncovered.length) missed.push(`  ${file}: line ${uncovered.join(', ')}`)
}

if (!total) {
    console.log(`${TOOL}: no executable changed lines in domain/ or application/`)
    process.exit(0)
}
const percent = Math.round((covered / total) * 1000) / 10
const verdict = `${covered}/${total} changed lines in domain/ and application/ covered (${percent}%, bar ≥ ${MIN_PERCENT}%)`
if (percent >= MIN_PERCENT) {
    console.log(`${TOOL}: ${verdict}`)
    process.exit(0)
}
const out = learn ? console.log : console.error
out(`${TOOL}: ${verdict}${learn ? ' — learn branch, reported only' : ''}`)
out('Not run by any test:')
for (const m of missed) out(m)
process.exit(learn ? 0 : 1)
