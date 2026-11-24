import type { ShownPerson } from '@/shared/domain'

/** A DM of a pair: its channel, its two people (smaller id first), and when it began. */
export interface DmPair {
    channelId: string
    userIds: [string, string]
    createdAt: Date
}

/** A DM as one of its two people keeps it. */
export interface DmEntry {
    channelId: string
    /** The other one as I see them (D-182: a deleted account, or one waiting to be, has no name). `avatarUrl` is the key. */
    other: ShownPerson
    /** The other account is deleted, or waiting to be: no one writes to it (D-182, spec 09 `deleted-account`). */
    otherGone: boolean
    /** When I closed it on my side; null while it is open for me (D-244). */
    closedAt: Date | null
    createdAt: Date
}

/** What opening a DM did, for whom it changed (`dm.created`, `dm.updated`). */
export interface OpenedDm {
    channelId: string
    /** Made now: both of the two hear of it. */
    created: boolean
    /** Was closed on the opener's side, and is open again. */
    reopened: boolean
}

/**
 * DM Repository Port — the DmChannel rows, and the Channel row (`type =
 * dm`, no server) each one stands on (D-244: social writes both, in one
 * transaction). A pair is opened under its own lock (advisory,
 * `relationship:<low>:<high>`, the same as for its relationship): two
 * opening it at once make one DM.
 */
export interface DmRepositoryPort {
    /** The DM of the pair, either way round, or null. */
    findByPair(userId: string, otherId: string): Promise<DmPair | null>
    /** The DM `channelId`, or null when it is no DM. */
    find(channelId: string): Promise<DmPair | null>
    /**
     * Under the pair's lock: the pair's DM, made (Channel and DmChannel) when
     * there is none, and open again on `userId`'s side. A DM made now is
     * closed on the other side as it is made: it shows for them once a
     * message comes (D-244).
     */
    open(userId: string, otherId: string): Promise<OpenedDm>
    /**
     * Closes the DM on `userId`'s side, now by the app's clock, which
     * stamps messages too (isShownDm). Null when it is not one of
     * theirs; false when it was closed already (the mark stays as it was).
     */
    close(userId: string, channelId: string): Promise<boolean | null>
    /** Every DM of the person, closed ones too, in no order. */
    entriesOf(userId: string): Promise<DmEntry[]>
    /** One DM of the person, or null when it is not one of theirs. */
    entryOf(userId: string, channelId: string): Promise<DmEntry | null>
    /** The channel ids of every DM of the person. */
    channelIdsOf(userId: string): Promise<string[]>
}

export const DM_REPOSITORY = Symbol('DmRepositoryPort')
