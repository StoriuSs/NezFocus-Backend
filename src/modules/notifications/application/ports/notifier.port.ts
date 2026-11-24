import {
    MessageMentionSources,
    MessagePlace,
    ModerationAction,
    TaskPlace,
    TaskReminder,
    UnassignedBy
} from '../../domain'

/** A message just sent or edited, and whom it is about (REQ-MSG-09). */
export interface MessageNotice extends MessagePlace {
    /** When it was sent: one older than the inbox keeps gets no new items on an edit. */
    sentAt: Date
    sources: MessageMentionSources
    /** Those of its people who had read the channel past it when it was saved: their items are made read (D-199). */
    readerIds: string[]
}

/** A task an item is about, with its title and due date now: the item keeps them as they were (D-98). */
export interface TaskNotice extends TaskPlace {
    title: string
    dueAt: Date | null
}

/** A server an item is about, with its name now: the item keeps it (spec 06 Q9). */
export interface ServerNotice {
    serverId: string
    serverName: string
}

/** What was done to a member (REQ-ROLE-04): never by whom. */
export interface ModerationNotice {
    action: ModerationAction
    reason: string | null
    /** A timeout: when it ends. */
    timeoutUntil: Date | null
}

/**
 * Notifier Port — how other modules put items in people's inboxes (D-185):
 * the only way in, so the rules every item follows are in one place (never
 * for the one who acted, nothing in a DM). Defined and answered by this
 * module, given by the global NotifierModule, so a module this one reads
 * from (messaging, D-198) can call it without importing it. No item for
 * someone who blocked the one it is from (D-242). Each call
 * resolves once the items are written; the caller runs it after its own
 * write is committed.
 */
export interface NotifierPort {
    /** A message sent or edited: one item for each person it mentions or answers now, none for the others (D-183, D-188). */
    messageMentions(notice: MessageNotice): Promise<void>

    /** Messages of one channel deleted: their items go (REQ-NOTIF-03). */
    messagesDeleted(channelId: string, messageIds: string[]): Promise<void>

    /** Someone read a channel up to a message: its mention and reply items up to it are read (D-188). */
    channelRead(userId: string, channelId: string, messageId: string): Promise<void>

    /** People put on a task by `actorId` (D-98): one "giao cho bạn" item each, none for who did it. */
    taskAssigned(notice: TaskNotice, actorId: string, userIds: string[]): Promise<void>

    /**
     * A task left with no one on it (D-95): `leaverId` took themselves off or
     * left the server. Its creator hears, unless they are the one who left.
     */
    taskUnassigned(notice: TaskNotice, creatorId: string, leaverId: string, by: UnassignedBy): Promise<void>

    /** A task due soon (REQ-TASK-04): one reminder for each person, once per mark and due date. */
    taskReminder(notice: TaskNotice & { dueAt: Date }, reminder: TaskReminder, userIds: string[]): Promise<void>

    /**
     * A task deleted (D-98, D-200): its items went with it; these people,
     * all who may have had one, hear of it with their unread count.
     */
    taskDeleted(taskId: string, userIds: string[]): Promise<void>

    /** The server handed to `toUserId` by `fromUserId` (REQ-SRV-05): one item for the new owner. */
    ownerTransferred(notice: ServerNotice, fromUserId: string, toUserId: string): Promise<void>

    /**
     * A member kicked, banned or timed out, or given a new length (REQ-ROLE-04,
     * D-188): one item for them, naming no one; a kick or ban that reached an
     * open app is read (D-187, D-201).
     */
    memberModerated(notice: ServerNotice, userId: string, moderation: ModerationNotice): Promise<void>

    /** One joined a server (again): their kick and ban items of it not read yet are read (D-202). */
    memberJoined(serverId: string, userId: string): Promise<void>

    /** `fromId` asked `toId` to be friends (REQ-SOCIAL-01): a `friend_request` item for them, with the note. */
    friendRequested(fromId: string, toId: string, note: string | null): Promise<void>

    /**
     * `accepterId` accepted the request of `requesterId` (D-111): its item goes,
     * and the one who asked gets a `friend_accepted` item.
     */
    friendAccepted(requesterId: string, accepterId: string): Promise<void>

    /** A request between the two declined, cancelled or ended by a block (REQ-NOTIF-03): its item goes. */
    friendRequestClosed(userId: string, otherId: string): Promise<void>
}

export const NOTIFIER = Symbol('NotifierPort')
