#!/usr/bin/env node
// secrets: gitleaks over the change only (CONSTRAINTS.md, "No secrets").
//
//   node scripts/constraints/secrets.mjs [--staged] [--base <ref>]
//
//   --staged   what the next commit holds (the pre-commit hook)
//   default    commits after the base, then everything not committed yet,
//              untracked files included
//
// --redact is not optional: a matched secret printed here would end up in a
// terminal log or an agent's transcript. gitleaks reports the rule and the
// place, never the value.
//
// Exit 0 clean, 1 a secret found or gitleaks missing, 2 the check could not run.
import { spawnSync } from 'node:child_process'
import { bail, git, goToTop, hasFlag, resolveBase } from './change.mjs'

const TOOL = 'secrets'
const COMMON = ['--redact', '--no-banner', '--no-color', '--log-level', 'warn', '--verbose']
goToTop(TOOL)

let failed = false
const gitleaks = (args) => {
    const run = spawnSync('gitleaks', [...args, ...COMMON], { stdio: 'inherit' })
    if (run.error?.code === 'ENOENT') {
        console.error(
            `${TOOL}: gitleaks is not installed, so nothing can be committed until it is.\n` +
                '  Windows: winget install --id Gitleaks.Gitleaks -e  (then restart the terminal / VS Code)\n' +
                '  Other:   https://github.com/gitleaks/gitleaks#installing'
        )
        process.exit(1)
    }
    if (run.status !== 0) failed = true
}

if (hasFlag('--staged')) {
    gitleaks(['git', '--pre-commit', '--staged'])
} else {
    const base = resolveBase(TOOL)
    const head = git(['rev-parse', 'HEAD'])?.trim()
    if (base !== head) gitleaks(['git', `--log-opts=${base}..HEAD`])
    gitleaks(['git', '--pre-commit'])
    gitleaks(['git', '--pre-commit', '--staged'])
    // gitleaks reads untracked files only through `dir`, one path at a time.
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    if (untracked === null) bail(TOOL, 'could not list untracked files')
    for (const f of untracked.split('\0').filter(Boolean)) gitleaks(['dir', f])
}

if (failed) {
    console.error(
        `${TOOL}: gitleaks found something (above, redacted). Move it to the environment or .env, not the code.`
    )
    process.exit(1)
}
console.log(`${TOOL}: clean`)
