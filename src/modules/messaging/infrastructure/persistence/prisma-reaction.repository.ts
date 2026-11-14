import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ReactionDecision, ReactionFacts, ReactionRepositoryPort, ReactionSummary, Reactors } from '../../domain'
import { AUTHOR, toAuthor } from './message.selections'

/**
 * Reactions, one row per (message, emoji, person); the key also serves every
 * read here, all of them by message.
 */
@Injectable()
export class PrismaReactionRepository implements ReactionRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async add(
        messageId: string,
        emoji: string,
        userId: string,
        decide: (facts: ReactionFacts) => ReactionDecision
    ): Promise<ReactionDecision> {
        return this.prisma.$transaction(async (tx) => {
            // The message's row, locked: reactions on it wait for each other
            // (the 20 emoji hold), and for a delete, which updates this row.
            // NO KEY UPDATE leaves replies to it (a foreign key) free to be sent.
            const [message] = await tx.$queryRaw<{ type: string; deletedAt: Date | null }[]>`
                SELECT "type", "deletedAt" FROM "Message" WHERE "id" = ${messageId} FOR NO KEY UPDATE
            `
            const emojis = await tx.reaction.groupBy({ by: ['emoji'], where: { messageId } })
            const mine = await tx.reaction.findUnique({
                where: { messageId_emoji_userId: { messageId, emoji, userId } },
                select: { userId: true }
            })
            const decision = decide({
                messageId,
                live: message !== undefined && message.deletedAt === null,
                system: message?.type === 'system',
                onMessage: emojis.some((row) => row.emoji === emoji),
                mine: mine !== null,
                emojiCount: emojis.length
            })
            if (decision === 'add') await tx.reaction.create({ data: { messageId, emoji, userId } })
            return decision
        })
    }

    async remove(messageId: string, emoji: string, userId: string): Promise<boolean> {
        const { count } = await this.prisma.reaction.deleteMany({ where: { messageId, emoji, userId } })
        return count > 0
    }

    async summaries(messageIds: string[], readerId: string): Promise<Map<string, ReactionSummary[]>> {
        if (messageIds.length === 0) return new Map()
        const [groups, mine] = await Promise.all([
            this.prisma.reaction.groupBy({
                by: ['messageId', 'emoji'],
                where: { messageId: { in: messageIds } },
                _count: { _all: true },
                _min: { createdAt: true }
            }),
            this.prisma.reaction.findMany({
                where: { messageId: { in: messageIds }, userId: readerId },
                select: { messageId: true, emoji: true }
            })
        ])
        const given = new Set(mine.map((row) => `${row.messageId} ${row.emoji}`))
        // In the order each emoji was first given (schema); the same instant: by emoji, so it never shuffles.
        groups.sort(
            (a, b) =>
                (a._min.createdAt?.getTime() ?? 0) - (b._min.createdAt?.getTime() ?? 0) ||
                (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0)
        )
        const summaries = new Map<string, ReactionSummary[]>()
        for (const group of groups) {
            const list = summaries.get(group.messageId) ?? []
            list.push({
                emoji: group.emoji,
                count: group._count._all,
                me: given.has(`${group.messageId} ${group.emoji}`)
            })
            summaries.set(group.messageId, list)
        }
        return summaries
    }

    async reactors(messageId: string, emoji: string, limit: number): Promise<Reactors> {
        const [rows, count] = await Promise.all([
            this.prisma.reaction.findMany({
                where: { messageId, emoji },
                orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
                take: limit,
                select: { user: AUTHOR }
            }),
            this.prisma.reaction.count({ where: { messageId, emoji } })
        ])
        return { users: rows.map((row) => toAuthor(row.user)), count }
    }
}
