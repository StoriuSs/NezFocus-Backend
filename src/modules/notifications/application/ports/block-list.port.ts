/**
 * Block List Port — whom people blocked (REQ-SOCIAL-03, REQ-NOTIF-03,
 * D-242): an inbox hides the items of people its owner blocked, shown again
 * once unblocked, and NOTIFIER makes no item for someone who blocked the
 * one it is from. Defined here, answered by the social module through its
 * global BlockListModule (the MESSAGE_PREVIEWS way, D-198): the code depends
 * one way only, social on notifications.
 */
export interface BlockListPort {
    /** Whom the person blocked. */
    blockedBy(userId: string): Promise<string[]>

    /** Those of `userIds` who blocked `blockedId`. */
    blockersAmong(blockedId: string, userIds: string[]): Promise<string[]>
}

export const BLOCK_LIST = Symbol('BlockListPort')
