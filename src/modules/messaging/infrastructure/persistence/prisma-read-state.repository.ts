import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ChannelReadState, READ_COUNT_CAP, ReadScope, ReadStateRepositoryPort } from '../../domain'

/**
 * ReadState rows, and the counts read from Message and MessageMention when
 * asked (D-164): nothing is counted when a message is sent.
 */
@Injectable()
export class PrismaReadStateRepository implements ReadStateRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async markRead(userId: string, channelId: string, messageId: string): Promise<void> {
        // One statement, so two tabs marking at once keep the later of the two (D-173).
        await this.prisma.$executeRaw`
            INSERT INTO "ReadState" ("userId", "channelId", "lastReadId", "updatedAt")
            VALUES (${userId}, ${channelId}, ${messageId}, now())
            ON CONFLICT ("userId", "channelId") DO UPDATE
            SET "lastReadId" = GREATEST("ReadState"."lastReadId", EXCLUDED."lastReadId"), "updatedAt" = now()
        `
    }

    /**
     * One statement for the channels of a server. Where each starts: the later
     * of the row and the floor (D-170; GREATEST skips a missing row). Each
     * count, and each half of the mention count, stops at READ_COUNT_CAP (the
     * union of two capped halves still reaches the cap when either does) and
     * walks the index on (channelId, id). Mentions: the person's
     * MessageMention rows, and the messages whose mentions reach many
     * (@everyone, @here, @role) that reach them, written with the very
     * condition of Message_broad_mentions_idx so the planner uses it (EXPLAIN,
     * M2 L1); one message both ways counts once. `roleIds` may hold roles of
     * other servers: a message only mentions roles of its own. Messages from
     * the person (theirs, or a system message about them) are neither (D-172,
     * D-173); deleted ones have no mention left and are not unread.
     */
    async states(userId: string, roleIds: string[], channels: ReadScope[]): Promise<ChannelReadState[]> {
        if (channels.length === 0) return []
        const rows = await this.prisma.$queryRaw<ChannelReadState[]>`
            SELECT c."channelId", r."lastReadId",
                (SELECT count(*) FROM (
                    SELECT 1 FROM "Message" m
                    WHERE m."channelId" = c."channelId" AND m."id" > r."lastReadId"
                        AND m."deletedAt" IS NULL
                        AND COALESCE(m."authorId", m."systemData"->>'userId') IS DISTINCT FROM ${userId}
                    LIMIT ${READ_COUNT_CAP}
                ) unread)::int AS "unreadCount",
                (SELECT count(*) FROM (
                    (SELECT mm."messageId" FROM "MessageMention" mm
                    WHERE mm."userId" = ${userId} AND mm."channelId" = c."channelId" AND mm."messageId" > r."lastReadId"
                    LIMIT ${READ_COUNT_CAP})
                    UNION
                    (SELECT m."id" FROM "Message" m
                    WHERE m."channelId" = c."channelId" AND m."id" > r."lastReadId"
                        AND (m."mentionEveryone" OR m."mentionHereUserIds" <> '{}' OR m."mentionRoleIds" <> '{}')
                        AND (m."mentionEveryone" OR ${userId} = ANY(m."mentionHereUserIds") OR m."mentionRoleIds" && ${roleIds}::text[])
                        AND m."authorId" IS DISTINCT FROM ${userId}
                    LIMIT ${READ_COUNT_CAP})
                    LIMIT ${READ_COUNT_CAP}
                ) mentions)::int AS "mentionCount"
            FROM unnest(${channels.map((c) => c.channelId)}::text[], ${channels.map((c) => c.floorId)}::text[])
                WITH ORDINALITY AS c("channelId", "floorId", "position")
            LEFT JOIN "ReadState" rs ON rs."userId" = ${userId} AND rs."channelId" = c."channelId"
            CROSS JOIN LATERAL (SELECT GREATEST(rs."lastReadId", c."floorId") AS "lastReadId") r
            ORDER BY c."position"
        `
        return rows
    }

    async readersPast(channelId: string, userIds: string[], messageId: string): Promise<string[]> {
        if (userIds.length === 0) return []
        // Through the primary key (userId, channelId), one row per person asked.
        const rows = await this.prisma.readState.findMany({
            where: { channelId, userId: { in: userIds }, lastReadId: { gte: messageId } },
            select: { userId: true }
        })
        return rows.map((row) => row.userId)
    }
}
