import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    AttachmentNotFoundError,
    ChannelNotFoundError,
    firstIdAt,
    MessageCursor,
    MessageMentions,
    MessagePage,
    MessageRecord,
    MessageRepositoryPort,
    NewMessage,
    StoredMessage,
    TASK_DUE_EARLIEST_MS,
    TaskDueData
} from '../../domain'
import { MESSAGE, STORED, toRecordOf, toRecords, toStored, Tx } from './message.selections'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/** What history pages show: a deleted message keeps its row (for answers to it), not its place in the list. */
const LIVE = { deletedAt: null } as const

/** How far apart the app's clock (which makes ids) and the database's (createdAt) may be. */
const CLOCK_MARGIN_MS = 60_000

/** A message deleted: its row kept for the replies to it, emptied of everything else. */
const emptied = (at: Date) => ({
    deletedAt: at,
    content: '',
    mentionEveryone: false,
    mentionHereUserIds: [],
    mentionRoleIds: []
})

/**
 * What goes with messages deleted, all of one channel, in their transaction:
 * their mention rows, reactions and pins; their files keep their place, lose
 * the message, and go with the next clean-up.
 */
async function letGo(tx: Tx, channelId: string, ids: string[]): Promise<void> {
    const messageId = { in: ids }
    await tx.messageMention.deleteMany({ where: { messageId } })
    await tx.reaction.deleteMany({ where: { messageId } })
    // With the channel: Pin's key is (channelId, messageId), and no index starts with messageId.
    await tx.pin.deleteMany({ where: { channelId, messageId } })
    await tx.attachment.updateMany({ where: { messageId }, data: { messageId: null } })
}

/**
 * Messages, read and written by id order (UUIDv7: id order is time order,
 * ARCHITECTURE 2.4). Every page walks the unique (channelId, id) index.
 */
@Injectable()
export class PrismaMessageRepository implements MessageRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async create({
        mentions,
        attachmentIds,
        ...message
    }: NewMessage): Promise<{ message: MessageRecord; created: boolean; deleted: boolean }> {
        try {
            const record = await this.prisma.$transaction(async (tx) => {
                // The message and its mention rows in one statement (D-164).
                const { id } = await tx.message.create({
                    data: {
                        ...message,
                        mentionEveryone: mentions.everyone,
                        mentionHereUserIds: mentions.hereUserIds,
                        mentionRoleIds: mentions.roleIds,
                        mentions: { create: mentions.userIds.map((userId) => ({ userId })) }
                    },
                    select: { id: true }
                })
                // Each file only if it is in no message yet: of two sends of one file at once, the
                // second waits for the first's row lock, then finds it taken, and saves nothing.
                // Locked in id order, whatever order they show in: two sends never wait on each other.
                const lost: string[] = []
                for (const attachmentId of [...attachmentIds].sort()) {
                    const { count } = await tx.attachment.updateMany({
                        where: { id: attachmentId, uploaderId: message.authorId, messageId: null, position: null },
                        data: { messageId: id, position: attachmentIds.indexOf(attachmentId) }
                    })
                    if (count === 0) lost.push(attachmentId)
                }
                if (lost.length) throw new AttachmentNotFoundError(lost)
                return toRecordOf(tx, await tx.message.findUniqueOrThrow({ where: { id }, select: MESSAGE }))
            })
            return { message: record, created: true, deleted: false }
        } catch (error) {
            // The channel went between the permission check and now.
            if (prismaCode(error) === 'P2003') throw new ChannelNotFoundError(message.channelId)
            // (authorId, nonce) is unique: a send of the same nonce saved first.
            if (prismaCode(error) !== 'P2002') throw error
            const sent = await this.findByNonce(message.authorId, message.nonce)
            if (!sent) throw error
            const { deleted, ...record } = sent
            return { message: record, created: false, deleted }
        }
    }

    async findByNonce(authorId: string, nonce: string): Promise<StoredMessage | null> {
        const row = await this.prisma.message.findUnique({
            where: { authorId_nonce: { authorId, nonce } },
            select: STORED
        })
        return row && toStored(this.prisma, row)
    }

    async find(id: string): Promise<StoredMessage | null> {
        const row = await this.prisma.message.findUnique({ where: { id }, select: STORED })
        return row && toStored(this.prisma, row)
    }

    async latestId(channelId: string): Promise<string | null> {
        const row = await this.prisma.message.findFirst({
            where: { channelId },
            orderBy: { id: 'desc' },
            select: { id: true }
        })
        return row?.id ?? null
    }

    async edit(id: string, content: string, mentions: MessageMentions, at: Date): Promise<MessageRecord | null> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const row = await tx.message.update({
                    where: { id, ...LIVE },
                    data: {
                        content,
                        editedAt: at,
                        mentionEveryone: mentions.everyone,
                        mentionHereUserIds: mentions.hereUserIds,
                        mentionRoleIds: mentions.roleIds
                    },
                    select: MESSAGE
                })
                // Who it is about, written again from the new text (D-164).
                await tx.messageMention.deleteMany({ where: { messageId: id } })
                await tx.messageMention.createMany({
                    data: mentions.userIds.map((userId) => ({ messageId: id, channelId: row.channelId, userId }))
                })
                return toRecordOf(tx, row)
            })
        } catch (error) {
            // Deleted (or gone with its channel) since the handler read it.
            if (prismaCode(error) === 'P2025') return null
            throw error
        }
    }

    async remove(id: string, channelId: string, at: Date): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            // Only a live row: of two deletes at once, one empties it, the other learns it is gone.
            const { count } = await tx.message.updateMany({ where: { id, channelId, ...LIVE }, data: emptied(at) })
            if (count === 0) return false
            await letGo(tx, channelId, [id])
            return true
        })
    }

    async removeRecent(
        channelId: string,
        authorId: string,
        { from, to }: { from: Date; to: Date },
        after: string | null,
        limit: number,
        at: Date
    ): Promise<string[]> {
        // Each batch starts after the one before, or at the window's first id, a minute early, as ids
        // are made by the app and createdAt by the database: the id > start bound keeps it to the window.
        // Postgres reads it as a BitmapAnd of (channelId, id) from start and the author's entries of
        // (authorId, nonce), so a batch costs more the more messages the author ever sent; measured at M7.
        const start = after ?? firstIdAt(new Date(from.getTime() - CLOCK_MARGIN_MS))
        return this.prisma.$transaction(async (tx) => {
            // Locked: a delete of one of them meanwhile waits, then finds it gone. Regular
            // messages only: a system message has no author (D-168).
            const rows = await tx.$queryRaw<{ id: string }[]>`
                SELECT "id" FROM "Message"
                WHERE "authorId" = ${authorId} AND "id" > ${start} AND "channelId" = ${channelId}
                    AND "deletedAt" IS NULL AND "createdAt" BETWEEN ${from} AND ${to}
                ORDER BY "id"
                LIMIT ${limit}
                FOR UPDATE`
            const ids = rows.map((row) => row.id)
            if (!ids.length) return ids
            await tx.message.updateMany({ where: { id: { in: ids } }, data: emptied(at) })
            await letGo(tx, channelId, ids)
            return ids
        })
    }

    async createMemberJoined(channelId: string, userId: string): Promise<MessageRecord | null> {
        try {
            const row = await this.prisma.message.create({
                data: { channelId, type: 'system', systemEvent: 'member_joined', systemData: { userId }, content: '' },
                select: MESSAGE
            })
            return await toRecordOf(this.prisma, row)
        } catch (error) {
            // The channel deleted meanwhile (its foreign key): nothing to write in.
            if (prismaCode(error) === 'P2003') return null
            throw error
        }
    }

    async createTaskDue(channelId: string, due: TaskDueData): Promise<MessageRecord | null> {
        // Said already, by a run of the same job: only from the earliest reminder on, along (channelId, id).
        const said = await this.prisma.message.findFirst({
            where: {
                channelId,
                id: { gte: firstIdAt(new Date(new Date(due.dueAt).getTime() - TASK_DUE_EARLIEST_MS)) },
                systemEvent: 'task_due',
                AND: [
                    { systemData: { path: ['taskId'], equals: due.taskId } },
                    { systemData: { path: ['reminder'], equals: due.reminder } },
                    { systemData: { path: ['dueAt'], equals: due.dueAt } }
                ]
            },
            select: { id: true }
        })
        if (said) return null
        try {
            const row = await this.prisma.message.create({
                data: { channelId, type: 'system', systemEvent: 'task_due', systemData: { ...due }, content: '' },
                select: MESSAGE
            })
            return await toRecordOf(this.prisma, row)
        } catch (error) {
            // The channel deleted meanwhile (its foreign key): nothing to write in.
            if (prismaCode(error) === 'P2003') return null
            throw error
        }
    }

    async page(channelId: string, cursor: MessageCursor, limit: number): Promise<MessagePage> {
        switch (cursor.kind) {
            case 'latest': {
                const older = await this.older(channelId, undefined, limit)
                return { items: older.items, hasMoreBefore: older.more, hasMoreAfter: false }
            }
            case 'before': {
                const [older, after] = await Promise.all([
                    this.older(channelId, cursor.id, limit),
                    this.exists(channelId, { gte: cursor.id })
                ])
                return { items: older.items, hasMoreBefore: older.more, hasMoreAfter: after }
            }
            case 'after': {
                const [newer, before] = await Promise.all([
                    this.newer(channelId, { gt: cursor.id }, limit),
                    this.exists(channelId, { lte: cursor.id })
                ])
                return { items: newer.items, hasMoreBefore: before, hasMoreAfter: newer.more }
            }
            case 'around': {
                const half = Math.floor(limit / 2)
                const [older, newer] = await Promise.all([
                    this.older(channelId, cursor.id, half),
                    this.newer(channelId, { gte: cursor.id }, limit - half)
                ])
                return {
                    items: [...older.items, ...newer.items],
                    hasMoreBefore: older.more,
                    hasMoreAfter: newer.more
                }
            }
        }
    }

    async findLive(ids: string[]): Promise<MessageRecord[]> {
        if (ids.length === 0) return []
        const rows = await this.prisma.message.findMany({ where: { id: { in: ids }, ...LIVE }, select: MESSAGE })
        return toRecords(this.prisma, rows)
    }

    async mentionedIn(messageId: string): Promise<string[]> {
        const rows = await this.prisma.messageMention.findMany({ where: { messageId }, select: { userId: true } })
        return rows.map((row) => row.userId)
    }

    /** Up to `limit` messages older than `beforeId` (or the newest), oldest first; `more` if there are others. */
    private async older(channelId: string, beforeId: string | undefined, limit: number) {
        if (limit === 0) return { items: [], more: await this.exists(channelId, { lt: beforeId }) }
        const rows = await this.prisma.message.findMany({
            where: { channelId, ...LIVE, ...(beforeId && { id: { lt: beforeId } }) },
            orderBy: { id: 'desc' },
            take: limit + 1,
            select: MESSAGE
        })
        return { items: await toRecords(this.prisma, rows.slice(0, limit).reverse()), more: rows.length > limit }
    }

    /** Up to `limit` messages matching `id`, oldest first; `more` if there are others. */
    private async newer(channelId: string, id: Prisma.StringFilter, limit: number) {
        const rows = await this.prisma.message.findMany({
            where: { channelId, ...LIVE, id },
            orderBy: { id: 'asc' },
            take: limit + 1,
            select: MESSAGE
        })
        return { items: await toRecords(this.prisma, rows.slice(0, limit)), more: rows.length > limit }
    }

    private async exists(channelId: string, id: Prisma.StringFilter): Promise<boolean> {
        const row = await this.prisma.message.findFirst({ where: { channelId, ...LIVE, id }, select: { id: true } })
        return row !== null
    }
}
