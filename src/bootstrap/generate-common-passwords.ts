// Builds src/modules/auth/domain/common-passwords.ts, the list the password
// policy refuses to build on (docs/auth/passwords-and-codes.md, "The
// common-password list").
//
//   pnpm passwords:generate                  download the list from SecLists
//   pnpm passwords:generate <file>           use a copy on disk
//
// Each entry goes through the policy's own baseWord(), so the list and the
// check can never normalise differently, and only what is left as 4+ letters
// is kept. Commit the result; nothing downloads it at run time.
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { baseWord } from '@/modules/auth/domain/password-policy'

const SOURCE_URL =
    'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt'
const OUTPUT = path.resolve(__dirname, '../modules/auth/domain/common-passwords.ts')

async function main(): Promise<void> {
    const file = process.argv[2]
    const text = file ? readFileSync(file, 'utf8') : await (await fetch(SOURCE_URL)).text()

    const words = new Set<string>()
    for (const line of text.split(/\r?\n/)) {
        const word = baseWord(line.trim())
        if (/^[a-z]{4,}$/.test(word)) words.add(word)
    }
    const sorted = [...words].sort()

    writeFileSync(
        OUTPUT,
        [
            "// Generated from SecLists' 10k-most-common.txt, (c) Daniel Miessler, MIT",
            '// licence: https://github.com/danielmiessler/SecLists. Each entry is',
            '// normalised the way password-policy.ts normalises a candidate (lower',
            '// case, digits and symbols trimmed from both ends, common substitutions',
            '// undone) and kept only if what is left is 4+ letters, so the set holds the',
            '// words people build passwords around, not their variants.',
            '//',
            `// ${sorted.length} words. Regenerate with \`pnpm passwords:generate\`; do not edit by hand.`,
            'export const COMMON_PASSWORD_WORDS = new Set(',
            `    \`${sorted.join('\n')}\`.split('\\n')`,
            ')',
            ''
        ].join('\n')
    )
    console.log(`${sorted.length} words written to ${path.relative(process.cwd(), OUTPUT)}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
