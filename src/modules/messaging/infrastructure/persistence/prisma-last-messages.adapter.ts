import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { LastMessage, LastMessagesPort } from '../../application/ports'
import { MESSAGE, toRecords } from './message.selections'

/**
 * LastMessagesPort over the Message table: per channel, the newest message
 * not deleted, found through the (channelId, id) index one channel at a
 * time, then read as the chat reads it (its mentions named, D-171).
 */
@Injectable()
export class PrismaLastMessages implements LastMessagesPort {
    constructor(private readonly prisma: PrismaService) {}

    async lastMessagesOf(channelIds: string[]): Promise<LastMessage[]> {
        if (channelIds.length === 0) return []
        const found = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT last.id
            FROM unnest(${channelIds}::text[]) AS c("channelId")
            CROSS JOIN LATERAL (
                SELECT m.id FROM "Message" m
                WHERE m."channelId" = c."channelId" AND m."deletedAt" IS NULL
                ORDER BY m.id DESC
                LIMIT 1
            ) last`)
        if (found.length === 0) return []
        const rows = await this.prisma.message.findMany({
            where: { id: { in: found.map((row) => row.id) } },
            select: MESSAGE
        })
        const records = await toRecords(this.prisma, rows)
        return records.map((record) => ({
            channelId: record.channelId,
            id: record.id,
            type: record.type,
            systemEvent: record.systemEvent,
            authorId: record.author?.id ?? null,
            content: record.content,
            mentionUsers: record.mentionUsers.map(({ id, username, displayName }) => ({ id, username, displayName })),
            files: {
                count: record.attachments.length,
                images: record.attachments.filter((file) => file.width !== null).length
            },
            createdAt: record.createdAt
        }))
    }
}
