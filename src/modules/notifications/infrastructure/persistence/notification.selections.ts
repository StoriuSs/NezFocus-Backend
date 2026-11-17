import { Prisma } from '@/generated/prisma/client'
import { shownPerson } from '@/shared/domain'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import { MentionReason, NotificationRecord } from '../../domain'

/** An item as the inbox reads it, its actor as others see them (D-182). */
export const NOTIFICATION = {
    id: true,
    userId: true,
    type: true,
    serverId: true,
    channelId: true,
    messageId: true,
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

export const toNotificationRecord = ({ data, actor, ...row }: NotificationRow): NotificationRecord => {
    const person = actor && shownPerson(actor)
    return {
        ...row,
        ...dataOf(data),
        actor: person && {
            id: person.id,
            username: person.username,
            displayName: person.displayName,
            avatarKey: person.avatarUrl
        }
    }
}
