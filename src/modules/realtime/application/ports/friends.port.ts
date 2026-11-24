/**
 * Friends Port — whom a person's presence also goes to (D-242): their
 * friends, besides the servers they are in (ARCHITECTURE 3.3). Defined here,
 * answered by the social module through its global FriendsModule: the code
 * depends one way only, social on realtime. Throws when it cannot be read:
 * presence then changes nothing and the next signal tries again, as when
 * the servers cannot be read.
 */
export interface FriendsPort {
    /** The ids of the person's friends. */
    friendIdsOf(userId: string): Promise<string[]>
}

export const FRIENDS = Symbol('FriendsPort')
