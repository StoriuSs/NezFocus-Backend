/**
 * Display name and bio rules (SRS REQ-AUTH-06, D-69, D-139).
 *
 * Both are composed (NFC) and trimmed before they are checked and stored, and
 * their limits count code points: "ễ" typed as e + two combining marks is one
 * character, an emoji is one character, and the browser counts the same way
 * (`[...text].length`). Counting UTF-16 units, as JavaScript's `length` does,
 * made an emoji two and a decomposed Vietnamese letter three.
 */
export const DISPLAY_NAME_MAX_LENGTH = 32

export const BIO_MAX_LENGTH = 200

/**
 * Characters Unicode itself says to draw as nothing (Default_Ignorable_Code_Point:
 * U+200B, U+3164 Hangul filler, U+115F, U+FFA0, the bidi controls…) and
 * whitespace. A name made only of these looks empty in a member list.
 */
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}]/gu

/** Control characters (Cc): line breaks, tabs, NUL, escape… */
const CONTROL = /\p{Cc}/u

/** Control characters other than the line break a bio may have. */
const CONTROL_EXCEPT_LINE_BREAK = /(?!\n)\p{Cc}/u

/** The form a display name or bio is checked and stored in. */
export function normaliseProfileText(text: string): string {
    return text.normalize('NFC').trim()
}

/** Characters as these rules count them: code points. */
export function characterCount(text: string): number {
    return [...text].length
}

/** A normalised display name: 1-32 characters, at least one of them visible, no control characters. */
export function isDisplayName(name: string): boolean {
    const length = characterCount(name)
    return length >= 1 && length <= DISPLAY_NAME_MAX_LENGTH && !CONTROL.test(name) && hasVisibleCharacter(name)
}

/** A normalised bio: up to 200 characters; empty clears it; line breaks allowed. */
export function isBio(bio: string): boolean {
    return characterCount(bio) <= BIO_MAX_LENGTH && !CONTROL_EXCEPT_LINE_BREAK.test(bio)
}

/**
 * A provider's name (Google) as a display name: normalised and cut at 32
 * characters, between code points so an emoji is never split in half. Null
 * when nothing usable is left; the "complete your account" step asks for one.
 */
export function displayNameFrom(providerName: string | null | undefined): string | null {
    if (!providerName) return null
    const cut = [...normaliseProfileText(providerName)].slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trim()
    return isDisplayName(cut) ? cut : null
}

function hasVisibleCharacter(text: string): boolean {
    return text.replace(INVISIBLE, '').length > 0
}
