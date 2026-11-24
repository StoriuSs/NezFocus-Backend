import { UserDirectoryPort } from '@/modules/users'
import {
    MentionReason,
    NotificationPerson,
    NotificationRecord,
    NotificationType,
    ServerItemFacts,
    TaskItemFacts
} from '../../domain'
import { MessagePreview, MessagePreviewsPort } from '../ports'

/** The person an item is from, the picture as an address; nulls for an account deleted or waiting to be (D-182). */
export interface NotificationPersonView {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** One inbox item as `GET /me/notifications` and `notification.created` give it. */
export interface NotificationView {
    id: string
    type: NotificationType
    serverId: string | null
    channelId: string | null
    messageId: string | null
    taskId: string | null
    actor: NotificationPersonView | null
    reason: MentionReason | null
    roleId: string | null
    /** The message now, for a mention or a reply. */
    message: MessagePreview | null
    /** The task as it was when the item was made (D-98), for a task item. */
    task: TaskItemFacts | null
    /** The server and what was done, as when the item was made, for an owner or moderation item (spec 06 Q9). */
    server: ServerItemFacts | null
    /** A friend request's note, if any. */
    note: string | null
    readAt: Date | null
    createdAt: Date
}

/** What views read: pictures, and the messages items are about. */
export interface NotificationViewSources {
    users: UserDirectoryPort
    previews: MessagePreviewsPort
}

/** The picture's address, or none when it cannot be signed: an item never fails for a picture. */
async function addressOf(users: UserDirectoryPort, key: string): Promise<string | null> {
    try {
        return await users.avatarUrl(key)
    } catch {
        return null
    }
}

/** The items that show their message now: mentions and replies. A missed call names its message only to be read with it (D-242). */
const showsMessage = (type: NotificationType) => type === 'mention' || type === 'reply'

/**
 * The items as views, in the order given, each message read once for all of
 * them (D-184). An item whose message was deleted is left out: its row goes
 * after the delete is committed (REQ-NOTIF-03), so it may still be there.
 */
export async function notificationViews(
    { users, previews }: NotificationViewSources,
    records: NotificationRecord[]
): Promise<NotificationView[]> {
    const people = records.map((record) => record.actor).filter((actor): actor is NotificationPerson => !!actor)
    const keys = [...new Set(people.map((person) => person.avatarKey).filter((key): key is string => !!key))]
    const asked = new Map<string, { id: string; serverId: string }>()
    for (const { type, messageId, serverId } of records) {
        if (showsMessage(type) && messageId && serverId) asked.set(messageId, { id: messageId, serverId })
    }
    const [urls, messages] = await Promise.all([
        Promise.all(keys.map(async (key) => [key, await addressOf(users, key)] as const)).then(
            (pairs) => new Map(pairs)
        ),
        asked.size > 0
            ? previews.previewsOf([...asked.values()]).then((found) => new Map(found.map((one) => [one.id, one])))
            : Promise.resolve(new Map<string, MessagePreview>())
    ])
    return records.flatMap(({ actor, userId: _userId, ...record }) => {
        const shown = showsMessage(record.type) && record.messageId
        const message = shown ? messages.get(record.messageId!) : undefined
        if (shown && !message) return []
        return [
            {
                ...record,
                actor: actor && {
                    id: actor.id,
                    username: actor.username,
                    displayName: actor.displayName,
                    avatarUrl: actor.avatarKey ? (urls.get(actor.avatarKey) ?? null) : null
                },
                message: message ?? null
            }
        ]
    })
}
