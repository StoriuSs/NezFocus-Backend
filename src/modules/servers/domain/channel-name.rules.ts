/**
 * Names of channels, rooms and categories (REQ-SRV-02, D-84): 1–100
 * characters, counted in code points after composing (NFC), as the browser's
 * counter does.
 *
 * A text channel's name is stored normalised: lower case, whitespace turned
 * into "-", only letters (accents kept), digits, "-" and "_", no run of "-"
 * and none at either end. "Hỏi Đáp Chung" becomes "hỏi-đáp-chung". Rooms and
 * categories keep the name as typed, trimmed.
 */
export const CHANNEL_NAME_MAX_LENGTH = 100

/** Channels and categories together, per server (REQ-SRV-02). */
export const MAX_CHANNELS_AND_CATEGORIES = 500

/** Whitespace and the characters Unicode draws as nothing (U+200B, U+3164…). */
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}]/gu
/** Control characters: line breaks, tabs, NUL… A name is one line. */
const CONTROL = /\p{Cc}/u
/** Everything a text channel's name may not keep. Marks stay: some accents have no precomposed letter. */
const NOT_KEPT = /[^\p{L}\p{M}\p{N}_-]/gu
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/** What a text channel called `typed` is stored as; may come out empty ("???"). */
export function normaliseTextChannelName(typed: string): string {
    return typed
        .normalize('NFC')
        .toLowerCase()
        .replace(/\s+/gu, '-')
        .replace(NOT_KEPT, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .normalize('NFC')
}

/** What a room or a category called `typed` is stored as. */
export function normaliseFreeName(typed: string): string {
    return typed.normalize('NFC').trim()
}

/** Why a normalised name cannot be used, or null when it can. */
export type ChannelNameProblem = 'length' | 'no_letter_or_digit'

/** A stored text channel name: 1–100 characters, at least one letter or digit ("__" alone is not a name). */
export function textChannelNameProblem(name: string): ChannelNameProblem | null {
    const length = [...name].length
    if (length === 0) return 'length'
    if (length > CHANNEL_NAME_MAX_LENGTH) return 'length'
    return LETTER_OR_DIGIT.test(name) ? null : 'no_letter_or_digit'
}

/** A stored room or category name: 1–100 characters, one line, something visible. */
export function freeNameProblem(name: string): ChannelNameProblem | null {
    const length = [...name].length
    const fits = length >= 1 && length <= CHANNEL_NAME_MAX_LENGTH
    return fits && !CONTROL.test(name) && name.replace(INVISIBLE, '').length > 0 ? null : 'length'
}
