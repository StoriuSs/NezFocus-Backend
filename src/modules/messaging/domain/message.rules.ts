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
 * A normalised message text: 1-2000 characters. Nothing left after
 * normalising is refused; once files can be sent, a message of files alone
 * will pass (D-93).
 */
export function isMessageContent(text: string): boolean {
    const length = characterCount(text)
    return length >= 1 && length <= MAX_MESSAGE_LENGTH
}
