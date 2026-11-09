/**
 * A server's name (REQ-SRV-01): 2–100 characters. Composed (NFC) and trimmed
 * before it is checked and stored, and counted in code points, as the
 * browser's counter does (`[...text].length`): "Ôn" typed decomposed is still
 * two characters.
 */
export const SERVER_NAME_MIN_LENGTH = 2
export const SERVER_NAME_MAX_LENGTH = 100

/** Whitespace and the characters Unicode draws as nothing (U+200B, U+3164…). */
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}]/gu

/** Control characters: line breaks, tabs, NUL… A name is one line. */
const CONTROL = /\p{Cc}/u

/** The form a server name is checked and stored in. */
export function normaliseServerName(name: string): string {
    return name.normalize('NFC').trim()
}

/** A normalised name: 2–100 characters, at least one visible, no control characters. */
export function isServerName(name: string): boolean {
    const length = [...name].length
    return (
        length >= SERVER_NAME_MIN_LENGTH &&
        length <= SERVER_NAME_MAX_LENGTH &&
        !CONTROL.test(name) &&
        name.replace(INVISIBLE, '').length > 0
    )
}
