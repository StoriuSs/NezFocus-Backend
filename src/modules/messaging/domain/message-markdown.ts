/*
 * The client's reading of a message's formatting (REQ-MSG-02;
 * NezFocus-Frontend `src/features/messaging/lib/markdown.ts`), copied so the
 * server knows which words the client draws as text: a mention counts only
 * there, never in code or in a link (D-172). Change both together; the
 * cases of `message-markdown.spec.ts` are the client's.
 *
 * Bold `**`, italic `*` or `_`, strikethrough `~~`, inline code (one or two
 * backticks), code blocks (```), quotes ("> "), a backslash before a marker
 * for the marker itself, and http / https addresses as links.
 */

type Inline =
    | { type: 'text'; text: string }
    | { type: 'bold' | 'italic' | 'strike'; children: Inline[] }
    | { type: 'code'; text: string }
    | { type: 'link'; href: string }

type Block = { type: 'paragraph' | 'quote'; children: Inline[] } | { type: 'codeBlock' }

const FENCE = '```'
/** What a backslash may stand before: the markers themselves. */
const ESCAPABLE = new Set(['\\', '*', '_', '~', '`', '>'])
const URL_START = /^https?:\/\/[^\s<]+/
/** Punctuation after an address that ends the sentence, not the address. */
const TRAILING = /[.,:;!?'"]$/
const WORD = /[\p{L}\p{N}]/u

const isWord = (char: string | undefined) => char !== undefined && WORD.test(char)
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)

/** The runs of words the client draws as text, in order: what is neither code nor a link. */
export function proseText(content: string): string[] {
    const words = (parts: Inline[]): string[] =>
        parts.flatMap((part) =>
            part.type === 'text'
                ? [part.text]
                : part.type === 'code' || part.type === 'link'
                  ? []
                  : words(part.children)
        )
    return parseMessage(content).flatMap((block) => (block.type === 'codeBlock' ? [] : words(block.children)))
}

/** The message as blocks: paragraphs and quotes of inline parts, and code blocks. */
function parseMessage(content: string): Block[] {
    const blocks: Block[] = []
    let rest = content
    for (;;) {
        const open = rest.indexOf(FENCE)
        const close = open === -1 ? -1 : rest.indexOf(FENCE, open + FENCE.length)
        if (close === -1) break
        // The line breaks on each side of a fence belong to it.
        blocks.push(...proseBlocks(rest.slice(0, open).replace(/\n$/, '')))
        blocks.push({ type: 'codeBlock' })
        rest = rest.slice(close + FENCE.length).replace(/^\n/, '')
    }
    blocks.push(...proseBlocks(rest))
    return blocks
}

/** Text outside code blocks: runs of quoted lines, and paragraphs between them. */
function proseBlocks(text: string): Block[] {
    if (!text) return []
    const blocks: Block[] = []
    let run = null as { quote: boolean; lines: string[] } | null
    const flush = () => {
        if (!run) return
        const children = parseInline(run.lines.join('\n'))
        if (children.length) blocks.push({ type: run.quote ? 'quote' : 'paragraph', children })
    }
    for (const line of text.split('\n')) {
        const quote = line.startsWith('> ')
        const kept = quote ? line.slice(2) : line
        if (run?.quote === quote) run.lines.push(kept)
        else {
            flush()
            run = { quote, lines: [kept] }
        }
    }
    flush()
    return blocks
}

/** The inline parts of a piece of text; neighbouring text joined into one part. */
function parseInline(text: string): Inline[] {
    const parts: Inline[] = []
    let plain = ''
    const push = (part: Inline) => {
        if (plain) parts.push({ type: 'text', text: plain })
        plain = ''
        parts.push(part)
    }

    let at = 0
    while (at < text.length) {
        const char = text[at]!
        const next = text[at + 1]

        if (char === '\\' && next !== undefined && ESCAPABLE.has(next)) {
            plain += next
            at += 2
            continue
        }

        if (char === '`') {
            const code = codeSpan(text, at)
            if (code) {
                push({ type: 'code', text: code.text })
                at = code.end
                continue
            }
            const run = /^`+/.exec(text.slice(at))![0]
            plain += run
            at += run.length
            continue
        }

        if (char === 'h' && !isWord(text[at - 1])) {
            const href = address(text.slice(at))
            if (href) {
                push({ type: 'link', href })
                at += href.length
                continue
            }
        }

        const span = delimited(text, at)
        if (span) {
            push({ type: span.type, children: parseInline(span.inside) })
            at = span.end
            continue
        }

        plain += char
        at += 1
    }
    if (plain) parts.push({ type: 'text', text: plain })
    return parts
}

/** Inline code opening at `at`: a run of one or two backticks, closed by the same run. */
function codeSpan(text: string, at: number): { text: string; end: number } | null {
    const run = /^`+/.exec(text.slice(at))![0]
    if (run.length > 2) return null
    let from = at + run.length
    for (;;) {
        const close = text.indexOf(run, from)
        if (close === -1) return null
        // Exactly the same run: a longer one does not close it.
        if (text[close + run.length] === '`' || text[close - 1] === '`') {
            from = close + 1
            continue
        }
        const inside = text.slice(at + run.length, close)
        if (!inside) return null
        return { text: inside, end: close + run.length }
    }
}

/** An http or https address at the start of `text`, without the punctuation that ends the sentence. */
function address(text: string): string | null {
    let href = URL_START.exec(text)?.[0]
    if (!href) return null
    for (;;) {
        if (TRAILING.test(href)) href = href.slice(0, -1)
        else if (href.endsWith(')') && count(href, '(') < count(href, ')')) href = href.slice(0, -1)
        else break
    }
    return /^https?:\/\/[^/?#]/.test(href) ? href : null
}

const count = (text: string, char: string) => text.split(char).length - 1

type Span = { type: 'bold' | 'italic' | 'strike'; inside: string; end: number }

/** Bold, italic or strikethrough opening at `at`, with what it holds; null if it does not close. */
function delimited(text: string, at: number): Span | null {
    if (text.startsWith('**', at)) {
        const span = closeAt(text, at, '**', (end) => text[end + 2] !== '*')
        if (span) return { type: 'bold', ...span }
    }
    if (text.startsWith('~~', at)) {
        const span = closeAt(text, at, '~~', () => true)
        if (span) return { type: 'strike', ...span }
    }
    if (text[at] === '*' && text[at + 1] !== '*') {
        const span = closeAt(text, at, '*', (end) => text[end - 1] !== '*' && text[end + 1] !== '*')
        if (span) return { type: 'italic', ...span }
    }
    if (text[at] === '_' && text[at + 1] !== '_' && !isWord(text[at - 1])) {
        const span = closeAt(text, at, '_', (end) => !isWord(text[end + 1]) && text[end + 1] !== '_')
        if (span) return { type: 'italic', ...span }
    }
    return null
}

/**
 * Where `marker` opening at `at` closes: the next one after something that
 * is not a space, itself after something that is not a space, and that
 * `fits` (no `*` of a `**` taken as an italic's end).
 */
function closeAt(
    text: string,
    at: number,
    marker: string,
    fits: (end: number) => boolean
): { inside: string; end: number } | null {
    const start = at + marker.length
    if (isSpace(text[start])) return null
    let end = text.indexOf(marker, start + 1)
    while (end !== -1) {
        if (!isSpace(text[end - 1]) && fits(end)) return { inside: text.slice(start, end), end: end + marker.length }
        end = text.indexOf(marker, end + 1)
    }
    return null
}
