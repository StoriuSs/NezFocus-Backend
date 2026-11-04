// What a change touches, shared by the checks in this folder (CONSTRAINTS.md).
//
// The change is measured against a base:
//   --base <ref>     given explicitly (CI passes the commit before the push)
//   learn/* branch   where the branch left main, so the whole rewrite counts
//   otherwise        HEAD: whatever is not committed yet, which is how this
//                    repository works (the owner commits on main at the end
//                    of a milestone's build phase)
// --staged reads what the next commit holds instead (the git hooks).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

export const git = (args) => {
    try {
        return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024
        })
    } catch {
        return null
    }
}

// Exit 2 means the check could not run, which must never read as clean.
export const bail = (tool, message) => {
    console.error(`${tool}: ${message}`)
    process.exit(2)
}

export const option = (name) => {
    const i = process.argv.indexOf(name)
    return i > -1 ? process.argv[i + 1] : undefined
}
export const hasFlag = (name) => process.argv.includes(name)

// git paths are relative to the top of the work tree, so every check runs from there.
export function goToTop(tool) {
    const top = git(['rev-parse', '--show-toplevel'])?.trim()
    if (!top) bail(tool, 'not inside a git work tree')
    process.chdir(top)
}

export const onLearnBranch = () => (git(['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? '').startsWith('learn/')

export function resolveBase(tool) {
    const given = option('--base')
    const ref = given ?? (onLearnBranch() ? null : 'HEAD')
    const sha = ref
        ? git(['rev-parse', '--verify', `${ref}^{commit}`])?.trim()
        : git(['merge-base', 'main', 'HEAD'])?.trim()
    if (!sha) bail(tool, `no base commit (${ref ?? 'merge-base with main'})`)
    return sha
}

// The change as added lines (with their line numbers in the new file),
// removed lines, and deleted files. Untracked files count as added in full:
// `git diff` alone cannot see a new file.
export function readChange(tool, { staged = false, base } = {}) {
    const args = staged
        ? ['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff', '--']
        : ['diff', '--unified=0', '--no-color', '--no-ext-diff', base, '--']
    const diff = git(args)
    if (diff === null) bail(tool, 'could not read the diff')

    const added = []
    const removed = []
    const deleted = []
    const pathOf = (s) => s.replace(/^[ab]\//, '')
    let file = ''
    let oldFile = ''
    let line = 0
    let inHeader = false
    // `---` and `+++` are file headers only between a file's `diff` line and
    // its first hunk; inside a hunk an added `++i` shows as `+++i`.
    for (const text of diff.split('\n')) {
        if (text.startsWith('diff ')) inHeader = true
        else if (text.startsWith('@@')) {
            inHeader = false
            line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0)
        } else if (inHeader) {
            if (text.startsWith('--- ')) oldFile = pathOf(text.slice(4))
            else if (text.startsWith('+++ ')) {
                const newFile = pathOf(text.slice(4))
                file = newFile === '/dev/null' ? oldFile : newFile
                if (newFile === '/dev/null') deleted.push(file)
            }
        } else if (text.startsWith('+')) added.push({ file, line: line++, text: text.slice(1) })
        else if (text.startsWith('-')) removed.push({ file, text: text.slice(1) })
    }

    if (!staged) {
        const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
        if (untracked === null) bail(tool, 'could not list untracked files')
        for (const f of untracked.split('\0').filter(Boolean)) {
            if (statSync(f).size > 2 * 1024 * 1024) continue
            const content = readFileSync(f, 'utf8')
            if (content.includes('\0')) continue // binary
            content.split(/\r?\n/).forEach((text, i) => added.push({ file: f, line: i + 1, text }))
        }
    }
    return { added, removed, deleted }
}

// Files the change adds lines to and that still exist, for the checks that
// run a tool over files (lint, related tests).
export const touchedFiles = (change) => [...new Set(change.added.map((a) => a.file))].filter((f) => existsSync(f))
