#!/usr/bin/env node
// floor-guard: the floor of CONSTRAINTS.md, checked on the change only.
// Adapted from the reference in the agent-skills constraint-driven-development
// skill (references/floor-guard.md); the rules and exit codes are the same.
//
//   node scripts/constraints/floor-guard.mjs [--staged] [--base <ref>] [--msg-file <file>] [--ci]
//
//   --staged     what the next commit holds (the commit-msg hook)
//   --msg-file   that commit's message
//   --ci         read the messages of the commits after --base instead
//
// A removed test or assertion needs a reason: a "Tests-removed: <why>" line in
// the commit message. With no message to read (pnpm check:task), it is listed
// as needing one, and the commit-msg hook and CI enforce it.
//
// A change to CONSTRAINTS.md that lowers the bar (a looser threshold, a rule
// removed) is the owner's decision (CONSTRAINTS.md): it passes only with a
// "Constraints-approved: <why>" line in the commit message, and is printed
// either way so it stays loud.
//
// On a learn/* branch the stub rules are off: the rewrite starts from
// signatures and TODO(human) bodies (docs/WORKFLOW.md, B3). Everything else
// still applies there.
//
// Exit 0 clean, 1 a floor violation, 2 the guard could not run.
import { readFileSync } from 'node:fs'
import { bail, git, goToTop, hasFlag, onLearnBranch, option, readChange, resolveBase } from './change.mjs'

const TOOL = 'floor-guard'
goToTop(TOOL)

const staged = hasFlag('--staged')
const base = staged ? undefined : resolveBase(TOOL)
const { added, removed, deleted } = readChange(TOOL, { staged, base })
const learn = onLearnBranch()

let message = null
const msgFile = option('--msg-file')
if (msgFile) message = readFileSync(msgFile, 'utf8')
else if (hasFlag('--ci')) {
    message = git(['log', '--format=%B', `${base}..HEAD`])
    if (message === null) bail(TOOL, 'could not read the commit messages')
}
const testsRemovedReason = message !== null && /^Tests-removed:\s*\S/m.test(message)
const constraintsApproved = message !== null && /^Constraints-approved:\s*\S/m.test(message)

const findings = []
const flag = (rule, file, text) => findings.push({ rule, file, text: text.trim().slice(0, 120) })
const isCode = (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && f !== 'scripts/constraints/floor-guard.mjs'
const isTest = (f) => /[.-]spec\.ts$|\.test\.[jt]s$/.test(f)
const isConstraints = (f) => /(^|\/)CONSTRAINTS\.md$/.test(f)

// 1. A silenced checker.
const SUPPRESSIONS =
    /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|biome-ignore|istanbul ignore|c8 ignore|nosemgrep|gitleaks:allow|Stryker disable/
// 4. Unfinished work.
const STUBS =
    /throw new (Error|NotImplemented)\w*\(.*[Nn]ot implemented|catch\s*\(\w*\)\s*\{\s*\}|catch\s*\{\s*\}|\bTODO\b/
// 2. A test made easier. `.only` belongs here too: every other test stops running.
const SKIPS = /\.(skip|todo|only)\b|\bxit\(|\bxdescribe\(|\bxtest\(/

for (const { file, text } of added) {
    if (isCode(file)) {
        if (SUPPRESSIONS.test(text)) flag('silenced-checker', file, text)
        if (!learn && STUBS.test(text)) flag('unfinished-work', file, text)
        if (SKIPS.test(text) && isTest(file)) flag('test-made-easier', file, text)
    }
    if (isConstraints(file) && /^\| *(W|E)\d+ *\|/.test(text)) flag('new-exception', file, text)
}

// 2b. A test file deleted, or an assertion removed from a test that stayed.
for (const f of deleted) if (isTest(f)) flag('test-deleted', f, 'file deleted')
for (const { file, text } of removed) {
    if (isTest(file) && !deleted.includes(file) && /\b(expect|assert|should)\b/.test(text)) {
        flag('assertion-removed', file, text)
    }
}

// 1b/2c. A rule in CONSTRAINTS.md weakened or removed. A rule is a bullet
// (keyed by its text before the first colon) or a table row (keyed by its
// first cell). Each number carries a direction read from the words around it:
// a minimum (>=, ≥, at least, must not fall) loosens by going down, a maximum
// (<=, ≤, under, must not grow) by going up. A number with no readable
// direction is reported whenever it changes. Digits that belong to a name or
// a date (M0, NFR-PERF-04, 05/11/2026, 700/1278) are not thresholds: without
// this, writing a measurement over "measured after M0" reads as a change. A
// unit written on the number (2500ms) still counts.
const ruleKey = (t) => {
    const s = t.trim()
    if (s.startsWith('|'))
        return (
            s
                .split('|')
                .map((c) => c.trim())
                .filter(Boolean)[0] ?? ''
        )
    if (/^[-*] /.test(s)) return s.slice(2).split(':')[0].trim()
    return null
}
const isException = (t) => /^\| *(W|E)\d+ *\|/.test(t.trim())
const MIN_BEFORE = /(>=|>|≥|at least|minimum|\bmin\b|no less than|not fall|not drop)\s*$/
const MAX_BEFORE = /(<=|<|≤|at most|maximum|\bmax\b|no more than|under|below|not grow|not exceed)\s*$/
const MIN_AFTER = /^\s*\S*\s*(?:\|\s*)?(or more|or higher|must not fall|must not drop)/
const MAX_AFTER = /^\s*\S*\s*(?:\|\s*)?(or less|or lower|must not grow|must not exceed)/
const thresholds = (t) => {
    const out = []
    const re = /(?<![\w./-])\d+(?:\.\d+)?(?![/.-]?\d)/g
    let m
    while ((m = re.exec(t))) {
        const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase()
        const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase()
        const dir =
            MIN_BEFORE.test(before) || MIN_AFTER.test(after)
                ? 'min'
                : MAX_BEFORE.test(before) || MAX_AFTER.test(after)
                  ? 'max'
                  : null
        out.push({ n: Number(m[0]), dir })
    }
    return out
}
const removedRules = removed.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null)
const addedRules = added.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null)
for (const r of removedRules) {
    const a = addedRules.find((x) => ruleKey(x.text) === ruleKey(r.text))
    if (!a) {
        if (!isException(r.text)) flag('rule-removed', r.file, r.text) // dropping an exception tightens
        continue
    }
    const before = thresholds(r.text)
    const after = thresholds(a.text)
    let verdict = null
    for (const dir of ['min', 'max', null]) {
        const was = before.filter((x) => x.dir === dir)
        const now = after.filter((x) => x.dir === dir)
        was.forEach((b, i) => {
            const n = now[i]
            if (verdict) return
            if (!n) verdict = 'threshold-removed'
            else if (n.n === b.n) return
            else if (dir === 'min' ? n.n < b.n : dir === 'max' ? n.n > b.n : true) {
                verdict = dir ? 'threshold-loosened' : 'threshold-changed'
            }
        })
    }
    if (verdict) flag(verdict, r.file, `${r.text}  ->  ${a.text}`)
}

// A removed test with its reason in the commit message passes; with no
// message to read yet, it is listed but does not fail.
const NEEDS_REASON = ['test-deleted', 'assertion-removed']
// The same for a lowered bar in CONSTRAINTS.md, with the owner's approval.
const NEEDS_APPROVAL = ['threshold-loosened', 'threshold-changed', 'threshold-removed', 'rule-removed']
const needsReason = findings.filter((f) => NEEDS_REASON.includes(f.rule))
const needsApproval = findings.filter((f) => NEEDS_APPROVAL.includes(f.rule))
const blocking = findings.filter((f) =>
    NEEDS_REASON.includes(f.rule)
        ? message !== null && !testsRemovedReason
        : NEEDS_APPROVAL.includes(f.rule)
          ? message !== null && !constraintsApproved
          : true
)

const where = staged ? 'staged' : `since ${base.slice(0, 12)}`
if (needsReason.length && !needsReason.some((f) => blocking.includes(f))) {
    const note = testsRemovedReason
        ? 'the commit message gives the reason (Tests-removed:)'
        : 'the commit message must give the reason: a line "Tests-removed: <why>"'
    console.log(`${TOOL}: tests removed ${where}, ${note}:`)
    for (const f of needsReason) console.log(`  [${f.rule}] ${f.file}: ${f.text}`)
}
if (needsApproval.length && !needsApproval.some((f) => blocking.includes(f))) {
    const note = constraintsApproved
        ? 'approved in the commit message (Constraints-approved:)'
        : `the commit message must carry the owner's approval: a line "Constraints-approved: <why>"`
    console.log(`${TOOL}: the bar in CONSTRAINTS.md is lowered ${where}, ${note}:`)
    for (const f of needsApproval) console.log(`  [${f.rule}] ${f.file}: ${f.text}`)
}
if (!blocking.length) {
    if (!needsReason.length && !needsApproval.length)
        console.log(`${TOOL}: clean (${where}${learn ? ', learn branch' : ''})`)
    process.exit(0)
}
console.error(`${TOOL}: ${blocking.length} floor violation(s) ${where}:`)
for (const f of blocking) console.error(`  [${f.rule}] ${f.file}: ${f.text}`)
if (blocking.some((f) => NEEDS_REASON.includes(f.rule))) {
    console.error('\nA removed test needs a line "Tests-removed: <why>" in the commit message.')
}
if (blocking.some((f) => NEEDS_APPROVAL.includes(f.rule))) {
    console.error(
        `\nLowering the bar in CONSTRAINTS.md is the owner's decision: a line "Constraints-approved: <why>" in the commit message.`
    )
}
if (blocking.some((f) => f.rule === 'rule-removed')) {
    console.error(
        '\nA rule-removed finding can also mean the rule was renamed: rename a rule in one commit and change its numbers in another.'
    )
}
console.error('\nEach is a move that lowers the bar (CONSTRAINTS.md). Fix the code, or route it through an exception.')
process.exit(1)
