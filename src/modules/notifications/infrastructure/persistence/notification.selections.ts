import { Prisma } from '@/generated/prisma/client'
import { shownPerson } from '@/shared/domain'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import {
    MentionReason,
    ModerationAction,
    NotificationRecord,
    ServerItemFacts,
    TaskItemFacts,
    TaskReminder,
    UnassignedBy
} from '../../domain'

/** An item as the inbox reads it, its actor as others see them (D-182). */
export const NOTIFICATION = {
    id: true,
    userId: true,
    type: true,
    serverId: true,
    channelId: true,
    messageId: true,
    taskId: true,
    data: true,
    readAt: true,
    createdAt: true,
    actor: { select: SHOWN_PERSON }
} satisfies Prisma.NotificationSelect

export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION }>

/** What a mention or reply item keeps in `data`: why it was made (spec 06 › Chữ). */
export interface MessageItemData {
    reason: MentionReason | null
    roleId: string | null
}

export const dataOf = (data: Prisma.JsonValue): MessageItemData => {
    const kept = (data ?? {}) as Partial<MessageItemData>
    return { reason: kept.reason ?? null, roleId: kept.roleId ?? null }
}

/** What a task item keeps in `data`, as it was when made (D-98): the due date as an ISO time. */
// A type, not an interface: Prisma takes it as JSON only with an index signature.
export type TaskItemData = {
    title: string
    dueAt: string | null
    reminder?: TaskReminder
    unassignedBy?: UnassignedBy
}

export const taskDataOf = ({ title, dueAt, reminder, unassignedBy }: TaskItemFacts): TaskItemData => ({
    title,
    dueAt: dueAt?.toISOString() ?? null,
    ...(reminder && { reminder }),
    ...(unassignedBy && { unassignedBy })
})

const taskFactsOf = (data: Prisma.JsonValue): TaskItemFacts => {
    const kept = (data ?? {}) as Partial<TaskItemData>
    return {
        title: kept.title ?? '',
        dueAt: kept.dueAt ? new Date(kept.dueAt) : null,
        reminder: kept.reminder ?? null,
        unassignedBy: kept.unassignedBy ?? null
    }
}

/**
 * What an owner or moderation item keeps in `data`, as it was when made
 * (spec 06 Q9): the server's name; on moderation, the action, when a timeout
 * ends (ISO) and the reason.
 */
// A type, not an interface: Prisma takes it as JSON only with an index signature.
export type ServerItemData = {
    serverName: string
    action?: ModerationAction
    timeoutUntil?: string
    reason?: string
}

export const serverDataOf = ({ name, action, timeoutUntil, reason }: ServerItemFacts): ServerItemData => ({
    serverName: name,
    ...(action && { action }),
    ...(timeoutUntil && { timeoutUntil: timeoutUntil.toISOString() }),
    ...(reason && { reason })
})

const serverFactsOf = (data: Prisma.JsonValue): ServerItemFacts => {
    const kept = (data ?? {}) as Partial<ServerItemData>
    return {
        name: kept.serverName ?? '',
        action: kept.action ?? null,
        timeoutUntil: kept.timeoutUntil ? new Date(kept.timeoutUntil) : null,
        reason: kept.reason ?? null
    }
}

/** What a friend request keeps in `data`: its note, if any (REQ-SOCIAL-01). */
// A type, not an interface: Prisma takes it as JSON only with an index signature.
export type FriendItemData = { note?: string }

export const friendDataOf = (note: string | null): FriendItemData => (note ? { note } : {})

export const toNotificationRecord = ({ data, actor, ...row }: NotificationRow): NotificationRecord => {
    const person = actor && shownPerson(actor)
    const isMessage = row.type === 'mention' || row.type === 'reply'
    const isServer = row.type === 'owner_transferred' || row.type === 'moderation'
    return {
        ...row,
        ...(isMessage ? dataOf(data) : { reason: null, roleId: null }),
        task: row.taskId ? taskFactsOf(data) : null,
        server: isServer ? serverFactsOf(data) : null,
        note: row.type === 'friend_request' ? (((data ?? {}) as FriendItemData).note ?? null) : null,
        actor: person && {
            id: person.id,
            username: person.username,
            displayName: person.displayName,
            avatarKey: person.avatarUrl
        }
    }
}
