/**
 * Someone as other people see them: the one rule that decides it (D-182).
 *
 * An account waiting 14 days to be deleted is still live (D-141), yet others
 * see it as deleted, as they will once its personal data is erased: no
 * username, no name, no picture; the client writes "Deleted account".
 * Restoring it brings them back. Every module that shows a person to someone
 * else goes through here: repositories read the columns with
 * `SHOWN_PERSON` (shared/infrastructure/persistence/shown-person.ts), and a
 * handler that has a user from `UserDirectoryPort` asks `isHidden`.
 */

/** What the rule reads of an account. */
export interface PersonFacts {
    id: string
    username: string | null
    displayName: string | null
    /** The stored picture's key, as in the column. */
    avatarUrl: string | null
    deletedAt: Date | null
    deletionRequestedAt: Date | null
}

/** What others see. `avatarUrl` is the stored picture's key. */
export interface ShownPerson {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** Deleted, or waiting to be: shown as a deleted account. */
export const isHidden = (user: Pick<PersonFacts, 'deletedAt' | 'deletionRequestedAt'>): boolean =>
    user.deletedAt !== null || user.deletionRequestedAt !== null

export function shownPerson(user: PersonFacts): ShownPerson {
    if (isHidden(user)) return { id: user.id, username: null, displayName: null, avatarUrl: null }
    return { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
}
