import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    ChannelNotFoundError,
    MessageCursor,
    MessagePage,
    MessageRecord,
    MessageRepositoryPort,
    NewMessage
} from '../../domain'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/** What the chat reads of a message, its author's name and picture key included. */
const MESSAGE = {
    id: true,
    channelId: true,
    type: true,
    content: true,
    systemEvent: true,
    systemData: true,
    editedAt: true,
    createdAt: true,
    author: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
} satisfies Prisma.MessageSelect

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE }>

const toRecord = ({ author, systemData, ...row }: MessageRow): MessageRecord => ({
    ...row,
    author: author && {
        id: author.id,
        username: author.username,
        displayName: author.displayName,
        avatarKey: author.avatarUrl
    },
    systemData: (systemData as Record<string, unknown> | null) ?? null
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

    async create(message: NewMessage): Promise<{ message: MessageRecord; created: boolean }> {
        try {
            const row = await this.prisma.message.create({ data: message, select: MESSAGE })
            return { message: toRecord(row), created: true }
        } catch (error) {
            // The channel went between the permission check and now.
            if (prismaCode(error) === 'P2003') throw new ChannelNotFoundError(message.channelId)
            // (authorId, nonce) is unique: a send of the same nonce saved first.
            if (prismaCode(error) !== 'P2002') throw error
            const sent = await this.findByNonce(message.authorId, message.nonce)
            if (!sent) throw error
            return { message: sent, created: false }
        }
    }

    async findByNonce(authorId: string, nonce: string): Promise<MessageRecord | null> {
        const row = await this.prisma.message.findUnique({
            where: { authorId_nonce: { authorId, nonce } },
            select: MESSAGE
        })
        return row && toRecord(row)
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
