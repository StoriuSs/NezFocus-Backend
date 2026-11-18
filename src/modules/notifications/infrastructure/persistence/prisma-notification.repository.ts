import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    HeldMessageItem,
    MessageItemsPlan,
    MessagePlace,
    NotificationPage,
    NotificationRecord,
    NotificationRepositoryPort,
    RemovedNotification,
    TaskItemDraft,
    TaskPlace,
    TaskReminder
} from '../../domain'
import { dataOf, MessageItemData, NOTIFICATION, taskDataOf, toNotificationRecord } from './notification.selections'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/** The client a Prisma transaction callback is given. */
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

/** Rows written by one statement: a channel of 500 people is one (D-183, measured in L6). */
const WRITE_BATCH = 500

/** The item types a message makes, the ones reading a channel marks read (D-188). */
const MESSAGE_TYPES = Prisma.sql`'mention'::"NotificationType", 'reply'::"NotificationType"`

const batches = <T>(all: T[]): T[][] =>
    Array.from({ length: Math.ceil(all.length / WRITE_BATCH) }, (_, index) =>
        all.slice(index * WRITE_BATCH, (index + 1) * WRITE_BATCH)
    )

/** Deletes the items `where` names, saying which were unread. */
async function removeWhere(db: Tx | PrismaService, where: Prisma.Sql): Promise<RemovedNotification[]> {
    return db.$queryRaw<RemovedNotification[]>`
        DELETE FROM "Notification" WHERE ${where}
        RETURNING "id", "userId", "readAt" IS NULL AS "unread"
    `
}

/**
 * The inbox. Pages walk Notification_userId_id_idx backwards (UUIDv7: id
 * order is time order); the unread count, Notification_unread_idx; reading a
 * channel, Notification_userId_channelId_messageId_idx; the clean-up,
 * Notification_createdAt_idx (EXPLAIN, M3 L1).
 */
@Injectable()
export class PrismaNotificationRepository implements NotificationRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async heldForMessage(channelId: string, messageId: string): Promise<HeldMessageItem[]> {
        // With the channel: Notification_channelId_messageId_idx starts with it.
        const rows = await this.prisma.notification.findMany({
            where: { channelId, messageId },
            select: { id: true, userId: true, type: true, data: true }
        })
        return rows.map(({ data, type, ...row }) => ({
            ...row,
            type: type === 'reply' ? 'reply' : 'mention',
            ...dataOf(data)
        }))
    }

    async applyMessagePlan(
        { serverId, channelId, messageId, actorId }: MessagePlace,
        { add, remove, change }: MessageItemsPlan,
        readerIds: ReadonlySet<string>,
        at: Date
    ): Promise<{ added: NotificationRecord[]; removed: RemovedNotification[] }> {
        const written = await this.prisma.$transaction(async (tx) => {
            const ids: string[] = []
            for (const batch of batches(add)) {
                const rows = await tx.notification.createManyAndReturn({
                    data: batch.map(({ userId, type, reason, roleId }) => ({
                        userId,
                        type,
                        serverId,
                        channelId,
                        messageId,
                        actorId,
                        data: { reason, roleId } satisfies MessageItemData,
                        readAt: readerIds.has(userId) ? at : null
                    })),
                    // Written already, by a run of the same message's event: one item each (D-183).
                    skipDuplicates: true,
                    select: { id: true }
                })
                ids.push(...rows.map((row) => row.id))
            }
            // One write per new reason: an edit from @here to @everyone changes hundreds alike.
            const byReason = new Map<string, MessageItemsPlan['change']>()
            for (const item of change) {
                const key = `${item.type} ${item.reason} ${item.roleId}`
                byReason.set(key, [...(byReason.get(key) ?? []), item])
            }
            for (const group of byReason.values()) {
                const { type, reason, roleId } = group[0]!
                await tx.notification.updateMany({
                    where: { id: { in: group.map((item) => item.id) } },
                    data: { type, data: { reason, roleId } satisfies MessageItemData }
                })
            }
            const removed = remove.length > 0 ? await removeWhere(tx, Prisma.sql`"id" = ANY(${remove}::text[])`) : []
            return { ids, removed }
        })
        return { added: await this.records(written.ids), removed: written.removed }
    }

    async addTaskItems(
        { type, place, actorId, facts }: TaskItemDraft,
        userIds: string[],
        at: Date
    ): Promise<NotificationRecord[]> {
        if (userIds.length === 0) return []
        const data = taskDataOf(facts)
        try {
            const ids = await this.prisma.$transaction(async (tx) => {
                const written: string[] = []
                for (const batch of batches(userIds)) {
                    const rows = await tx.notification.createManyAndReturn({
                        data: batch.map((userId) => ({ userId, type, ...place, actorId, data, createdAt: at })),
                        select: { id: true }
                    })
                    written.push(...rows.map((row) => row.id))
                }
                return written
            })
            return await this.records(ids)
        } catch (error) {
            // The task (or its channel) deleted meanwhile: its items would have gone with it.
            if (prismaCode(error) === 'P2003') return []
            throw error
        }
    }

    async remindedAlready(
        { channelId, taskId }: TaskPlace,
        reminder: TaskReminder,
        dueAt: Date,
        userIds: string[]
    ): Promise<string[]> {
        if (userIds.length === 0) return []
        // With the channel: Notification_channelId_taskId_idx starts with it.
        const rows = await this.prisma.notification.findMany({
            where: {
                channelId,
                taskId,
                type: 'task_reminder',
                userId: { in: userIds },
                AND: [
                    { data: { path: ['reminder'], equals: reminder } },
                    { data: { path: ['dueAt'], equals: dueAt.toISOString() } }
                ]
            },
            select: { userId: true }
        })
        return [...new Set(rows.map((row) => row.userId))]
    }

    async removeForMessages(channelId: string, messageIds: string[]): Promise<RemovedNotification[]> {
        if (messageIds.length === 0) return []
        return removeWhere(
            this.prisma,
            Prisma.sql`"channelId" = ${channelId} AND "messageId" = ANY(${messageIds}::text[])`
        )
    }

    async markReadUpTo(userId: string, channelId: string, messageId: string, at: Date): Promise<string[]> {
        const rows = await this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE "Notification" SET "readAt" = ${at}
            WHERE "userId" = ${userId} AND "channelId" = ${channelId} AND "messageId" <= ${messageId}
                AND "type" IN (${MESSAGE_TYPES}) AND "readAt" IS NULL
            RETURNING "id"
        `
        return rows.map((row) => row.id)
    }

    async markRead(userId: string, ids: string[], at: Date): Promise<string[]> {
        if (ids.length === 0) return []
        const rows = await this.prisma.$queryRaw<{ id: string }[]>`
            UPDATE "Notification" SET "readAt" = ${at}
            WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[]) AND "readAt" IS NULL
            RETURNING "id"
        `
        return rows.map((row) => row.id)
    }

    async markAllRead(userId: string, beforeId: string, at: Date): Promise<number> {
        const { count } = await this.prisma.notification.updateMany({
            where: { userId, id: { lte: beforeId }, readAt: null },
            data: { readAt: at }
        })
        return count
    }

    async page(
        userId: string,
        channelIds: string[],
        beforeId: string | null,
        limit: number
    ): Promise<NotificationPage> {
        const rows = await this.prisma.notification.findMany({
            where: { userId, channelId: { in: channelIds }, ...(beforeId && { id: { lt: beforeId } }) },
            orderBy: { id: 'desc' },
            take: limit + 1,
            select: NOTIFICATION
        })
        return { items: rows.slice(0, limit).map(toNotificationRecord), more: rows.length > limit }
    }

    async unreadCount(userId: string, channelIds: string[]): Promise<number> {
        return this.prisma.notification.count({ where: { userId, readAt: null, channelId: { in: channelIds } } })
    }

    async removeOlderThan(cutoff: Date, limit: number): Promise<number> {
        return this.prisma.$executeRaw`
            DELETE FROM "Notification" WHERE "id" IN (
                SELECT "id" FROM "Notification" WHERE "createdAt" < ${cutoff} LIMIT ${limit}
            )
        `
    }

    /** The items, newest first. */
    private async records(ids: string[]): Promise<NotificationRecord[]> {
        if (ids.length === 0) return []
        const rows = await this.prisma.notification.findMany({
            where: { id: { in: ids } },
            orderBy: { id: 'desc' },
            select: NOTIFICATION
        })
        return rows.map(toNotificationRecord)
    }
}
