/**
 * The kinds of inbox item (spec 06): those of M3, and M6's friend requests and
 * missed calls, which belong to no server (D-242); reports come with M7
 * (D-144).
 */
export type NotificationType =
    | 'mention'
    | 'reply'
    | 'task_assigned'
    | 'task_reminder'
    | 'task_unassigned'
    | 'owner_transferred'
    | 'moderation'
    | 'friend_request'
    | 'friend_accepted'
    | 'missed_call'

/** The items of friend requests (D-111, D-242): a request to me, and my request accepted. */
export type FriendItemType = 'friend_request' | 'friend_accepted'

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

/** Which reminder a `task_reminder` item is: 24 hours or 2 hours before the due date (REQ-TASK-04). */
export type TaskReminder = '24h' | '2h'

/** Why a task has no one on it any more (D-95): its last person took themselves off, or left the server. */
export type UnassignedBy = 'withdrew' | 'left_server'

/**
 * What a task item keeps as it was when made (D-98): the title and due date
 * then; which reminder; why no one is on it. Opening it shows the task as
 * it is now.
 */
export interface TaskItemFacts {
    title: string
    dueAt: Date | null
    /** task_reminder only. */
    reminder: TaskReminder | null
    /** task_unassigned only. */
    unassignedBy: UnassignedBy | null
}

/**
 * Who gets a task item (D-98, D-95): each person once, never the one who
 * acted (D-185), so taking a task on oneself makes no item, and a creator
 * who left their own task hears nothing of it. Null: the app acted (a
 * reminder), everyone gets theirs. In the order given.
 */
export function taskItemRecipients(actorId: string | null, userIds: string[]): string[] {
    return [...new Set(userIds)].filter((userId) => userId !== actorId)
}

/** What was done to someone in a server (REQ-ROLE-04): put out, banned, or timed out (a new length too, D-188). */
export type ModerationAction = 'kick' | 'ban' | 'timeout'

/**
 * What an owner or moderation item keeps as it was when made (spec 06 Q9):
 * the server's name then; on a moderation item, what was done, when a
 * timeout ends, and why. Never who did it (REQ-ROLE-04).
 */
export interface ServerItemFacts {
    name: string
    /** moderation only. */
    action: ModerationAction | null
    /** A timeout: when it ends. */
    timeoutUntil: Date | null
    reason: string | null
}

/**
 * Whether a server item is made read (D-187, D-201): a kick or ban that
 * reached an open app showed its dialog (11 S-MOD-02), so it was seen. A
 * timeout has no dialog and a server handed over none either: both arrive
 * unread, open app or not.
 */
export function createdRead(action: ModerationAction | null, connected: boolean): boolean {
    return connected && (action === 'kick' || action === 'ban')
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
