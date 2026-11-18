import {
    HeldMessageItem,
    MentionReason,
    MessageItemsPlan,
    NotificationType,
    TaskItemFacts,
    TaskReminder
} from '../notification.rules'

/** The person an item is from, as others see them: none of an account deleted or waiting to be (D-182). */
export interface NotificationPerson {
    id: string
    username: string | null
    displayName: string | null
    avatarKey: string | null
}

/** One inbox item. */
export interface NotificationRecord {
    id: string
    userId: string
    type: NotificationType
    serverId: string | null
    channelId: string | null
    messageId: string | null
    taskId: string | null
    actor: NotificationPerson | null
    reason: MentionReason | null
    roleId: string | null
    /** A task item: the task as it was when the item was made (D-98). */
    task: TaskItemFacts | null
    readAt: Date | null
    createdAt: Date
}

/** The message an item set is about, and who it is from. */
export interface MessagePlace {
    serverId: string
    channelId: string
    messageId: string
    actorId: string
}

/** The task a task item is about, in its channel and server. */
export interface TaskPlace {
    serverId: string
    channelId: string
    taskId: string
}

/** The task items to write for some people: one kind, one task, the same words for each (D-98). */
export interface TaskItemDraft {
    type: 'task_assigned' | 'task_reminder' | 'task_unassigned'
    place: TaskPlace
    /** Who it names: the one who gave the task, or who left it; none for a reminder. */
    actorId: string | null
    facts: TaskItemFacts
}

/** An item taken off, and whether it was still unread (the badge drops by those). */
export interface RemovedNotification {
    id: string
    userId: string
    unread: boolean
}

/** A page of the inbox, newest first; `more` when older ones follow. */
export interface NotificationPage {
    items: NotificationRecord[]
    more: boolean
}

/**
 * Notification Repository Port — the Notification rows. Every read of a
 * person's inbox is limited to `channelIds`, the channels they view now
 * (REQ-NOTIF-03): the page and the unread count with the very same
 * condition, so the badge matches the list.
 */
export interface NotificationRepositoryPort {
    /** The items a message of the channel has now, one per person. */
    heldForMessage(channelId: string, messageId: string): Promise<HeldMessageItem[]>

    /**
     * Writes a message's items as `plan` says, in batches (D-183), in one
     * transaction; an item that is already there is not written twice
     * (unique userId + messageId). Those of `readerIds` are written read
     * (D-199). Gives the items written and those taken off.
     */
    applyMessagePlan(
        place: MessagePlace,
        plan: MessageItemsPlan,
        readerIds: ReadonlySet<string>,
        at: Date
    ): Promise<{ added: NotificationRecord[]; removed: RemovedNotification[] }>

    /**
     * Writes one task item for each of `userIds`, in batches, unread. None
     * when the task was deleted meanwhile (its items would have gone with it).
     */
    addTaskItems(draft: TaskItemDraft, userIds: string[], at: Date): Promise<NotificationRecord[]>

    /**
     * Those of `userIds` who already have the reminder of this mark and due
     * date of the task: a reminder's job run again writes none twice.
     */
    remindedAlready(place: TaskPlace, reminder: TaskReminder, dueAt: Date, userIds: string[]): Promise<string[]>

    /** Takes off the items of messages of one channel (deleted, REQ-NOTIF-03). */
    removeForMessages(channelId: string, messageIds: string[]): Promise<RemovedNotification[]>

    /** Marks read the person's mention and reply items of the channel up to `messageId` (D-188); the ids marked. */
    markReadUpTo(userId: string, channelId: string, messageId: string, at: Date): Promise<string[]>

    /** Marks read those of `ids` that are the person's and unread; the ids marked. */
    markRead(userId: string, ids: string[], at: Date): Promise<string[]>

    /** Marks read every item of the person up to `beforeId` (REQ-NOTIF-02); how many. */
    markAllRead(userId: string, beforeId: string, at: Date): Promise<number>

    /** Up to `limit` items older than `beforeId` (or the newest), newest first. */
    page(userId: string, channelIds: string[], beforeId: string | null, limit: number): Promise<NotificationPage>

    /** How many of the person's items are unread. */
    unreadCount(userId: string, channelIds: string[]): Promise<number>

    /** Deletes up to `limit` items made before `cutoff`, read or not; how many. */
    removeOlderThan(cutoff: Date, limit: number): Promise<number>
}

export const NOTIFICATION_REPOSITORY = Symbol('NotificationRepositoryPort')
