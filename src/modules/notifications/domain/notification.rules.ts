/** The kinds of inbox item (spec 06): those of M3; friends and reports come with their milestones (D-144). */
export type NotificationType =
    | 'mention'
    | 'reply'
    | 'task_assigned'
    | 'task_reminder'
    | 'task_unassigned'
    | 'owner_transferred'
    | 'moderation'

/** Why a message mentions someone, which the item's title says (spec 06 › Chữ): by name, a role, @everyone, @here. */
export type MentionReason = 'user' | 'role' | 'everyone' | 'here'

/**
 * Whom a message is about (REQ-MSG-09, D-39), as messaging worked it out
 * after it was saved: only people who view its channel (D-183).
 */
export interface MessageMentionSources {
    /** Mentioned by name. */
    users: string[]
    /** The author of the message it answers, even one deleted since (REQ-MSG-09). */
    repliedTo: string | null
    /** Each role it mentions in effect, in the order written, and those of its members who view the channel. */
    roles: { roleId: string; userIds: string[] }[]
    /** Reached by @everyone. */
    everyone: string[]
    /** The @here list taken when it was sent (D-166). */
    here: string[]
}

/** One person's item for a message, and why. */
export interface MessageItemReason {
    userId: string
    type: 'mention' | 'reply'
    /** Null for a reply. */
    reason: MentionReason | null
    /** The role, when `reason` is `role`. */
    roleId: string | null
}

/**
 * Who gets an item for a message, one each (REQ-NOTIF-01): the strongest
 * reason wins, by name, then a role (the first written), then @everyone,
 * then @here; a reply only when nothing else mentions its author. Never the
 * author (D-185). In the order of those reasons.
 */
export function messageRecipients(authorId: string, sources: MessageMentionSources): MessageItemReason[] {
    const found = new Map<string, MessageItemReason>()
    const give = (userIds: string[], item: Omit<MessageItemReason, 'userId'>) => {
        for (const userId of userIds) {
            if (userId !== authorId && !found.has(userId)) found.set(userId, { userId, ...item })
        }
    }
    give(sources.users, { type: 'mention', reason: 'user', roleId: null })
    for (const role of sources.roles) give(role.userIds, { type: 'mention', reason: 'role', roleId: role.roleId })
    give(sources.everyone, { type: 'mention', reason: 'everyone', roleId: null })
    give(sources.here, { type: 'mention', reason: 'here', roleId: null })
    if (sources.repliedTo) give([sources.repliedTo], { type: 'reply', reason: null, roleId: null })
    return [...found.values()]
}

/** An item a message already has. */
export interface HeldMessageItem extends MessageItemReason {
    id: string
}

/** What to write so a message's items match whom it mentions now. */
export interface MessageItemsPlan {
    add: MessageItemReason[]
    /** Ids of items to take off. */
    remove: string[]
    /** Items kept whose reason changed. */
    change: (Omit<MessageItemReason, 'userId'> & { id: string })[]
}

const sameReason = (a: MessageItemReason, b: MessageItemReason) =>
    a.type === b.type && a.reason === b.reason && a.roleId === b.roleId

/**
 * A message sent or edited (D-188): an item for each person it mentions now,
 * none for the others; an item kept keeps its read state. `addable`: false
 * for a message older than the inbox keeps, which gets no new items.
 */
export function planMessageItems(
    held: HeldMessageItem[],
    wanted: MessageItemReason[],
    addable: boolean
): MessageItemsPlan {
    const now = new Map(wanted.map((item) => [item.userId, item]))
    const had = new Set(held.map((item) => item.userId))
    const change: MessageItemsPlan['change'] = []
    for (const item of held) {
        const next = now.get(item.userId)
        if (next && !sameReason(item, next)) {
            change.push({ id: item.id, type: next.type, reason: next.reason, roleId: next.roleId })
        }
    }
    return {
        add: addable ? wanted.filter((item) => !had.has(item.userId)) : [],
        remove: held.filter((item) => !now.has(item.userId)).map((item) => item.id),
        change
    }
}

/** How long the inbox keeps an item (REQ-NOTIF-03, SRS 7.3). */
export const KEPT_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/** The oldest moment the inbox still keeps. */
export const keptSince = (now: Date): Date => new Date(now.getTime() - KEPT_DAYS * DAY_MS)

/** Whether something from `at` is still within the inbox's 90 days. */
export const isKept = (at: Date, now: Date): boolean => at.getTime() >= keptSince(now).getTime()

/** How many items one "mark read" names at most (SRS 5.1). */
export const MAX_READ_IDS = 100
