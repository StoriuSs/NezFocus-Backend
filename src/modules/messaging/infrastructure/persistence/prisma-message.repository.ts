import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    ChannelNotFoundError,
    MessageCursor,
    MessagePage,
    MessageRecord,
    MessageRepositoryPort,
    NewMessage,
    StoredMessage
} from '../../domain'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

const AUTHOR = { select: { id: true, username: true, displayName: true, avatarUrl: true } } as const

/**
 * What the chat reads of a message: its author's name and picture key, and
 * the message it answers as it is now (edited, or deleted).
 */
const MESSAGE = {
    id: true,
    channelId: true,
    type: true,
    content: true,
    systemEvent: true,
    systemData: true,
    editedAt: true,
    createdAt: true,
    author: AUTHOR,
    replyTo: { select: { id: true, content: true, deletedAt: true, author: AUTHOR } }
} satisfies Prisma.MessageSelect

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE }>
type AuthorRow = NonNullable<MessageRow['author']>

const toAuthor = (author: AuthorRow | null) =>
    author && {
        id: author.id,
        username: author.username,
        displayName: author.displayName,
        avatarKey: author.avatarUrl
    }

const toRecord = ({ author, systemData, replyTo, ...row }: MessageRow): MessageRecord => ({
    ...row,
    author: toAuthor(author),
    systemData: (systemData as Record<string, unknown> | null) ?? null,
    // A deleted message is quoted by its id alone (REQ-MSG-05).
    replyTo:
        replyTo &&
        (replyTo.deletedAt
            ? { id: replyTo.id, author: null, content: '', deleted: true }
            : { id: replyTo.id, author: toAuthor(replyTo.author), content: replyTo.content, deleted: false })
})

/** A message found by id or nonce: deleted ones too, saying so. */
const STORED = { ...MESSAGE, deletedAt: true } satisfies Prisma.MessageSelect

const toStored = ({ deletedAt, ...row }: Prisma.MessageGetPayload<{ select: typeof STORED }>): StoredMessage => ({
    ...toRecord(row),
    deleted: deletedAt !== null
})

/** What history pages show: a deleted message keeps its row (for answers to it), not its place in the list. */
const LIVE = { deletedAt: null } as const

/**
 * Messages, read and written by id order (UUIDv7: id order is time order,
 * ARCHITECTURE 2.4). Every page walks the unique (channelId, id) index.
 */
@Injectable()
export class PrismaMessageRepository implements MessageRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async create(message: NewMessage): Promise<{ message: MessageRecord; created: boolean; deleted: boolean }> {
        try {
            const row = await this.prisma.message.create({ data: message, select: MESSAGE })
            return { message: toRecord(row), created: true, deleted: false }
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
        return row && toStored(row)
    }

    async find(id: string): Promise<StoredMessage | null> {
        const row = await this.prisma.message.findUnique({ where: { id }, select: STORED })
        return row && toStored(row)
    }

    async edit(id: string, content: string, at: Date): Promise<MessageRecord | null> {
        try {
            const row = await this.prisma.message.update({
                where: { id, ...LIVE },
                data: { content, editedAt: at },
                select: MESSAGE
            })
            return toRecord(row)
        } catch (error) {
            // Deleted (or gone with its channel) since the handler read it.
            if (prismaCode(error) === 'P2025') return null
            throw error
        }
    }

    async remove(id: string, at: Date): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            // Only a live row: of two deletes at once, one empties it, the other learns it is gone.
            const { count } = await tx.message.updateMany({
                where: { id, ...LIVE },
                data: { deletedAt: at, content: '', mentionEveryone: false, mentionHereUserIds: [], mentionRoleIds: [] }
            })
            if (count === 0) return false
            await tx.messageMention.deleteMany({ where: { messageId: id } })
            await tx.reaction.deleteMany({ where: { messageId: id } })
            await tx.pin.deleteMany({ where: { messageId: id } })
            // Its files keep their place, lose the message, and go with the next clean-up.
            await tx.attachment.updateMany({ where: { messageId: id }, data: { messageId: null } })
            return true
        })
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

    /** Up to `limit` messages older than `beforeId` (or the newest), oldest first; `more` if there are others. */
    private async older(channelId: string, beforeId: string | undefined, limit: number) {
        if (limit === 0) return { items: [], more: await this.exists(channelId, { lt: beforeId }) }
        const rows = await this.prisma.message.findMany({
            where: { channelId, ...LIVE, ...(beforeId && { id: { lt: beforeId } }) },
            orderBy: { id: 'desc' },
            take: limit + 1,
            select: MESSAGE
        })
        return { items: rows.slice(0, limit).reverse().map(toRecord), more: rows.length > limit }
    }

    /** Up to `limit` messages matching `id`, oldest first; `more` if there are others. */
    private async newer(channelId: string, id: Prisma.StringFilter, limit: number) {
        const rows = await this.prisma.message.findMany({
            where: { channelId, ...LIVE, id },
            orderBy: { id: 'asc' },
            take: limit + 1,
            select: MESSAGE
        })
        return { items: rows.slice(0, limit).map(toRecord), more: rows.length > limit }
    }

    private async exists(channelId: string, id: Prisma.StringFilter): Promise<boolean> {
        const row = await this.prisma.message.findFirst({ where: { channelId, ...LIVE, id }, select: { id: true } })
        return row !== null
    }
}
