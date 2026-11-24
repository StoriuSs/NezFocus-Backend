import type { ShownPerson } from '@/shared/domain'
import type { PairState, RelationshipDecision, RelationshipType } from '../relationship.rules'

/**
 * A person in someone's list (`GET /me/relationships`) or the answer to a
 * change: as others see them (D-182: a deleted account, or one waiting to be,
 * has no name), and where they stand with the one reading.
 */
export interface RelationshipEntry {
    /** `avatarUrl` is the stored picture's key. */
    person: ShownPerson
    type: RelationshipType
    /** The note of their request to me; never mine to them (REQ-SOCIAL-01: only the receiver sees it). */
    note: string | null
    /** Since when: a request sent, a friendship accepted, a block made; null for none. */
    since: Date | null
}

/** A change of a pair: the pair before and after, as the one who acted sees it, and what was decided. */
export interface RelationshipChange {
    before: PairState
    after: PairState
    decision: RelationshipDecision
}

/**
 * Relationship Repository Port — the Relationship and Block rows. A pair is
 * changed under its own lock (advisory, `relationship:<low>:<high>`, D-242):
 * two people answering each other at once take turns, the second reading
 * what the first wrote.
 */
export interface RelationshipRepositoryPort {
    /**
     * Under the pair's lock: reads the pair as `actorId` sees it, writes what
     * `decide` says (nothing on a refusal), at `at`.
     */
    change(
        actorId: string,
        otherId: string,
        decide: (state: PairState) => RelationshipDecision,
        at: Date
    ): Promise<RelationshipChange>

    /**
     * Everyone in the person's list: friends, requests either way, people they
     * blocked. Accounts deleted for good are left out (D-243); in no order.
     */
    entriesOf(userId: string): Promise<RelationshipEntry[]>

    /** The other person as `viewerId` sees them, `none` included; null when there is no such account or it was deleted for good. */
    entryOf(viewerId: string, otherId: string): Promise<RelationshipEntry | null>

    /** The ids of the person's friends whose accounts are not deleted for good. */
    friendIdsOf(userId: string): Promise<string[]>

    /** Whom the person blocked. */
    blockedBy(userId: string): Promise<string[]>

    /** Those of `userIds` who blocked `blockedId`. */
    blockersAmong(blockedId: string, userIds: string[]): Promise<string[]>

    /**
     * Deletes every relationship and block of an account deleted for good
     * (D-243); the people a request was waiting with, either way, whose
     * inbox items go too.
     */
    forgetAccount(userId: string): Promise<string[]>
}

export const RELATIONSHIP_REPOSITORY = Symbol('RelationshipRepositoryPort')
