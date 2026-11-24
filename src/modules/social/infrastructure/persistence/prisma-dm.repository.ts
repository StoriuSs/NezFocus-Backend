import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { isHidden, shownPerson } from '@/shared/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import { DmEntry, DmPair, DmRepositoryPort, OpenedDm } from '../../domain'
import { lockPair, orderedPair } from './social-locks'

const PERSON = { select: SHOWN_PERSON } as const

const DM_ROW = {
    channelId: true,
    userLowId: true,
    userHighId: true,
    lowClosedAt: true,
    highClosedAt: true,
    createdAt: true,
    userLow: PERSON,
    userHigh: PERSON
} as const satisfies Prisma.DmChannelSelect

type DmRow = Prisma.DmChannelGetPayload<{ select: typeof DM_ROW }>

const pairOf = (row: Pick<DmRow, 'channelId' | 'userLowId' | 'userHighId' | 'createdAt'>): DmPair => ({
    channelId: row.channelId,
    userIds: [row.userLowId, row.userHighId],
    createdAt: row.createdAt
})

/** The row as `userId`, one of its two, keeps it. */
const entryOfRow = (userId: string, row: DmRow): DmEntry => {
    const low = row.userLowId === userId
    const other = low ? row.userHigh : row.userLow
    return {
        channelId: row.channelId,
        other: shownPerson(other),
        otherGone: isHidden(other),
        closedAt: low ? row.lowClosedAt : row.highClosedAt,
        createdAt: row.createdAt
    }
}

/** The column of one side's close mark. */
type CloseMark = 'lowClosedAt' | 'highClosedAt'

/** The close mark of the smaller id of the pair, or of the larger. */
const markOf = (low: boolean): CloseMark => (low ? 'lowClosedAt' : 'highClosedAt')

/** The DMs `userId` is one of the two of. */
const mine = (userId: string) => ({ OR: [{ userLowId: userId }, { userHighId: userId }] })

/**
 * The DmChannel rows, smaller id first (D-242), and the Channel row each
 * stands on (`type = dm`, no server, no category, no name: Channel_dm_check),
 * written together (D-244). Its dates and close marks come from the app's
 * clock, as a message's `createdAt` does (Prisma fills `@default(now())` in
 * the app, not in Postgres): "a message after the close" compares one clock
 * (isShownDm). The other person is read with SHOWN_PERSON
 * (D-182); a DM with an account deleted for good stays, its history kept
 * (spec 09 `deleted-account`).
 */
@Injectable()
export class PrismaDmRepository implements DmRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async findByPair(userId: string, otherId: string): Promise<DmPair | null> {
        const { low, high } = orderedPair(userId, otherId)
        const row = await this.prisma.dmChannel.findUnique({
            where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
            select: { channelId: true, userLowId: true, userHighId: true, createdAt: true }
        })
        return row && pairOf(row)
    }

    async find(channelId: string): Promise<DmPair | null> {
        const row = await this.prisma.dmChannel.findUnique({
            where: { channelId },
            select: { channelId: true, userLowId: true, userHighId: true, createdAt: true }
        })
        return row && pairOf(row)
    }

    async open(userId: string, otherId: string): Promise<OpenedDm> {
        const { low, high } = orderedPair(userId, otherId)
        const myMark = markOf(low === userId)
        const theirMark = markOf(low !== userId)
        return this.prisma.$transaction(async (tx) => {
            await lockPair(tx, low, high)
            const found = await tx.dmChannel.findUnique({
                where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
                select: { channelId: true, lowClosedAt: true, highClosedAt: true }
            })
            if (found) {
                if (!found[myMark]) return { channelId: found.channelId, created: false, reopened: false }
                await tx.dmChannel.update({ where: { channelId: found.channelId }, data: { [myMark]: null } })
                return { channelId: found.channelId, created: false, reopened: true }
            }
            const channel = await tx.channel.create({
                data: { type: 'dm', name: '', nameKey: '', position: 0 },
                select: { id: true }
            })
            // Closed on the other side as it is made: it shows for them with its first message (D-244).
            const at = new Date()
            await tx.dmChannel.create({
                data: { channelId: channel.id, userLowId: low, userHighId: high, createdAt: at, [theirMark]: at }
            })
            return { channelId: channel.id, created: true, reopened: false }
        })
    }

    async close(userId: string, channelId: string): Promise<boolean | null> {
        const row = await this.prisma.dmChannel.findFirst({
            where: { channelId, ...mine(userId) },
            select: { userLowId: true }
        })
        if (!row) return null
        const myMark = markOf(row.userLowId === userId)
        // Only if still open: a second close keeps the first mark, and the messages after it.
        const { count } = await this.prisma.dmChannel.updateMany({
            where: { channelId, [myMark]: null },
            data: { [myMark]: new Date() }
        })
        return count > 0
    }

    async entriesOf(userId: string): Promise<DmEntry[]> {
        const rows = await this.prisma.dmChannel.findMany({ where: mine(userId), select: DM_ROW })
        return rows.map((row) => entryOfRow(userId, row))
    }

    async entryOf(userId: string, channelId: string): Promise<DmEntry | null> {
        const row = await this.prisma.dmChannel.findFirst({
            where: { channelId, ...mine(userId) },
            select: DM_ROW
        })
        return row && entryOfRow(userId, row)
    }

    async channelIdsOf(userId: string): Promise<string[]> {
        const rows = await this.prisma.dmChannel.findMany({ where: mine(userId), select: { channelId: true } })
        return rows.map((row) => row.channelId)
    }
}
