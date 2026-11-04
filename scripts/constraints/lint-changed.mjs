#!/usr/bin/env node
// lint-changed: ESLint over the files the change touches, inside what `pnpm lint`
// covers. Type-aware linting loads the whole TypeScript program, so linting a
// handful of files costs about the same start-up as linting them all; the
// saving is in the rules run, and in the output staying about this change.
//
//   node scripts/constraints/lint-changed.mjs [--base <ref>]
//
// Exit 0 no errors, 1 lint errors, 2 the check could not run.
import { spawnSync } from 'node:child_process'
import { goToTop, readChange, resolveBase, touchedFiles } from './change.mjs'

const TOOL = 'lint-changed'
goToTop(TOOL)

const LINTED = /^(src|test)\/.*\.ts$|^k6\/.*\.js$/
const files = touchedFiles(readChange(TOOL, { base: resolveBase(TOOL) })).filter((f) => LINTED.test(f))
if (!files.length) {
    console.log(`${TOOL}: no linted files changed`)
    process.exit(0)
}

const run = spawnSync(process.execPath, ['node_modules/eslint/bin/eslint.js', '--no-warn-ignored', ...files], {
    stdio: 'inherit'
})
if (run.status === null) process.exit(2)
if (run.status === 0) console.log(`${TOOL}: ${files.length} file(s), no errors`)
process.exit(run.status)
