/** Longest message, in characters as people count them (code points, so an emoji is one; REQ-MSG-01). */
export const MAX_MESSAGE_LENGTH = 2000

/** History pages (SRS 5.1): 1-100 messages, 50 when the client does not say. */
export const MESSAGE_PAGE_DEFAULT = 50
export const MESSAGE_PAGE_MAX = 100

/**
 * The text of a message as it is checked and kept: composed (NFC), so a
 * letter typed with its accents apart counts as one, and without the blank
 * lines and spaces around it; those inside stay (a code block keeps its
 * indentation).
 */
export function normaliseMessageContent(text: string): string {
    return text.normalize('NFC').trim()
}

/** Characters as these rules count them: code points. */
export const characterCount = (text: string) => [...text].length

/**
 * A normalised message text: at most 2000 characters. It may be empty, when
 * the message has files (`hasSomething`, D-93).
 */
export function isMessageContent(text: string): boolean {
    return characterCount(text) <= MAX_MESSAGE_LENGTH
}

/** A message holds text or files, or is not one (REQ-MSG-01, D-93). */
export function hasSomething(text: string, fileCount: number): boolean {
    return characterCount(text) > 0 || fileCount > 0
}

/**
 * The smallest id of a message made at `at` (D-170, D-181). Ids are UUIDv7,
 * whose first 48 bits are the time in milliseconds, so this is the id of that
 * millisecond with every other bit as small as a UUIDv7 allows: every message
 * made before sorts below it, every one made from then on above. No message
 * has exactly these bits.
 */
export function firstIdAt(at: Date): string {
    const time = at.getTime().toString(16).padStart(12, '0')
    return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-000000000000`
}
