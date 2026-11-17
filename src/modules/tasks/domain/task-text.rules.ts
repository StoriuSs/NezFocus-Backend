/**
 * The words of a task (REQ-TASK-01): its title and description, and the
 * folded title it is searched by (D-97).
 *
 * Both are composed (NFC) and trimmed before they are checked and stored, and
 * their limits count code points, as the client's counter does
 * (`[...text].length`): an emoji is one character, and so is a Vietnamese
 * letter typed with its accents apart.
 */
export const TASK_TITLE_MAX_LENGTH = 200

export const TASK_DESCRIPTION_MAX_LENGTH = 2000

/** Whitespace and the characters Unicode draws as nothing: a title of only these looks empty. */
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}]/gu

/** Control characters (Cc): line breaks, tabs, NUL… A title is one line. */
const CONTROL = /\p{Cc}/u

/** Control characters other than the line break a description may have. */
const CONTROL_EXCEPT_LINE_BREAK = /(?!\n)\p{Cc}/u

/** The form a title or description is checked and stored in. */
export function normaliseTaskText(text: string): string {
    return text.normalize('NFC').trim()
}

const characterCount = (text: string) => [...text].length

/** A normalised title: 1-200 characters, at least one visible, on one line. */
export function isTaskTitle(title: string): boolean {
    const length = characterCount(title)
    return (
        length >= 1 &&
        length <= TASK_TITLE_MAX_LENGTH &&
        !CONTROL.test(title) &&
        title.replace(INVISIBLE, '').length > 0
    )
}

/** A normalised description: up to 2000 characters, empty for none, line breaks allowed. */
export function isTaskDescription(description: string): boolean {
    return characterCount(description) <= TASK_DESCRIPTION_MAX_LENGTH && !CONTROL_EXCEPT_LINE_BREAK.test(description)
}

/**
 * A title or the words searched for, as they are compared (D-97): without
 * accents ("đ" read as "d"), in lower case, trimmed. Stored beside the title
 * (`Task.titleSearch`) and applied to the words typed, the same function both
 * times, so the two always fold alike (ARCHITECTURE 7).
 */
export function foldForSearch(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().trim()
}

/** The words searched for, folded; nothing left of them is no search (null). */
export function searchWordsOf(search: string | null): string | null {
    const folded = search === null ? '' : foldForSearch(search)
    return folded === '' ? null : folded
}
