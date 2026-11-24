import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { ShownPerson, shownPerson } from '@/shared/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import {
    afterWrite,
    PairState,
    RelationshipChange,
    RelationshipDecision,
    RelationshipEntry,
    RelationshipRepositoryPort,
    Standing
} from '../../domain'
import { lockPair, orderedPair, Tx } from './social-locks'

const PERSON = { select: SHOWN_PERSON } as const

type PersonRow = Prisma.UserGetPayload<{ select: typeof SHOWN_PERSON }>

/** A pair's row as the change reads it. */
interface PairRow {
    requesterId: string
    status: 'pending' | 'accepted'
}

/** Where the pair stands for `userId`, from its row. */
const standingOf = (row: PairRow | null, userId: string): Standing => {
    if (!row) return 'none'
    if (row.status === 'accepted') return 'friend'
    return row.requesterId === userId ? 'outgoing' : 'incoming'
}

/** A relationship row and its other person, as `userId`'s list shows it. */
const entryOfRow = (
    userId: string,
    row: {
        requesterId: string
        status: 'pending' | 'accepted'
        note: string | null
        createdAt: Date
        acceptedAt: Date | null
    },
    other: PersonRow
): RelationshipEntry => {
    const type = standingOf(row, userId)
    return {
        person: shownPerson(other),
        type,
        note: type === 'incoming' ? row.note : null,
        since: row.acceptedAt ?? row.createdAt
    }
}

const blockedEntry = (person: ShownPerson, since: Date): RelationshipEntry => ({
    person,
    type: 'blocked',
    note: null,
    since
})

const RELATIONSHIP_FIELDS = {
    requesterId: true,
    status: true,
    note: true,
    createdAt: true,
    acceptedAt: true
} as const

/**
 * The Relationship and Block rows (social.prisma, D-242). A pair has one
 * Relationship row, smaller id first; blocks are one way. The other person
 * is read with SHOWN_PERSON (D-182); accounts deleted for good are left out
 * of every list (D-243).
 */
@Injectable()
export class PrismaRelationshipRepository implements RelationshipRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async change(
        actorId: string,
        otherId: string,
        decide: (state: PairState) => RelationshipDecision,
        at: Date
    ): Promise<RelationshipChange> {
        const { low, high } = orderedPair(actorId, otherId)
        const key = { userLowId_userHighId: { userLowId: low, userHighId: high } }
        return this.prisma.$transaction(async (tx) => {
            await lockPair(tx, low, high)
            const before = await this.stateIn(tx, actorId, otherId, key)
            const decision = decide(before)
            if ('refused' in decision) return { before, after: before, decision }
            switch (decision.write) {
                case 'request':
                    await tx.relationship.create({
                        data: {
                            userLowId: low,
                            userHighId: high,
                            requesterId: actorId,
                            note: decision.note,
                            createdAt: at
                        }
                    })
                    break
                case 'accept':
                    await tx.relationship.update({
                        where: key,
                        data: { status: 'accepted', acceptedAt: at, note: null }
                    })
                    break
                case 'remove':
                    await tx.relationship.delete({ where: key })
                    break
                case 'block':
                    await tx.relationship.deleteMany({ where: { userLowId: low, userHighId: high } })
                    await tx.block.create({ data: { blockerId: actorId, blockedId: otherId, createdAt: at } })
                    break
                case 'unblock':
                    await tx.block.delete({
                        where: { blockerId_blockedId: { blockerId: actorId, blockedId: otherId } }
                    })
                    break
                case 'nothing':
                    break
            }
            return { before, after: afterWrite(before, decision), decision }
        })
    }

    /** The pair as `actorId` sees it, read in `tx` under the pair's lock. */
    private async stateIn(
        tx: Tx,
        actorId: string,
        otherId: string,
        key: Prisma.RelationshipWhereUniqueInput
    ): Promise<PairState> {
        const row = await tx.relationship.findUnique({ where: key, select: { requesterId: true, status: true } })
        const blocks = await tx.block.findMany({
            where: {
                OR: [
                    { blockerId: actorId, blockedId: otherId },
                    { blockerId: otherId, blockedId: actorId }
                ]
            },
            select: { blockerId: true }
        })
        return {
            standing: standingOf(row, actorId),
            blocking: blocks.some(({ blockerId }) => blockerId === actorId),
            blockedBy: blocks.some(({ blockerId }) => blockerId === otherId)
        }
    }

    async entriesOf(userId: string): Promise<RelationshipEntry[]> {
        const live = { deletedAt: null }
        const [asLow, asHigh, blocks] = await Promise.all([
            this.prisma.relationship.findMany({
                where: { userLowId: userId, userHigh: live },
                select: { ...RELATIONSHIP_FIELDS, userHigh: PERSON }
            }),
            this.prisma.relationship.findMany({
                where: { userHighId: userId, userLow: live },
                select: { ...RELATIONSHIP_FIELDS, userLow: PERSON }
            }),
            this.prisma.block.findMany({
                where: { blockerId: userId, blocked: live },
                select: { createdAt: true, blocked: PERSON }
            })
        ])
        return [
            ...asLow.map(({ userHigh, ...row }) => entryOfRow(userId, row, userHigh)),
            ...asHigh.map(({ userLow, ...row }) => entryOfRow(userId, row, userLow)),
            ...blocks.map(({ blocked, createdAt }) => blockedEntry(shownPerson(blocked), createdAt))
        ]
    }

    async entryOf(viewerId: string, otherId: string): Promise<RelationshipEntry | null> {
        const { low, high } = orderedPair(viewerId, otherId)
        const [other, row, block] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: otherId }, select: SHOWN_PERSON }),
            this.prisma.relationship.findUnique({
                where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
                select: RELATIONSHIP_FIELDS
            }),
            this.prisma.block.findUnique({
                where: { blockerId_blockedId: { blockerId: viewerId, blockedId: otherId } },
                select: { createdAt: true }
            })
        ])
        if (!other || other.deletedAt) return null
        if (block) return blockedEntry(shownPerson(other), block.createdAt)
        if (row) return entryOfRow(viewerId, row, other)
        return { person: shownPerson(other), type: 'none', note: null, since: null }
    }

    async friendIdsOf(userId: string): Promise<string[]> {
        const live = { deletedAt: null }
        const [asLow, asHigh] = await Promise.all([
            this.prisma.relationship.findMany({
                where: { userLowId: userId, status: 'accepted', userHigh: live },
                select: { userHighId: true }
            }),
            this.prisma.relationship.findMany({
                where: { userHighId: userId, status: 'accepted', userLow: live },
                select: { userLowId: true }
            })
        ])
        return [...asLow.map((row) => row.userHighId), ...asHigh.map((row) => row.userLowId)]
    }

    async blockedBy(userId: string): Promise<string[]> {
        const rows = await this.prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } })
        return rows.map((row) => row.blockedId)
    }

    async blockersAmong(blockedId: string, userIds: string[]): Promise<string[]> {
        if (userIds.length === 0) return []
        const rows = await this.prisma.block.findMany({
            where: { blockedId, blockerId: { in: userIds } },
            select: { blockerId: true }
        })
        return rows.map((row) => row.blockerId)
    }

    async forgetAccount(userId: string): Promise<string[]> {
        return this.prisma.$transaction(async (tx) => {
            const ofPair = { OR: [{ userLowId: userId }, { userHighId: userId }] }
            const waiting = await tx.relationship.findMany({
                where: { ...ofPair, status: 'pending' },
                select: { userLowId: true, userHighId: true }
            })
            await tx.relationship.deleteMany({ where: ofPair })
            await tx.block.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } })
            return waiting.map((row) => (row.userLowId === userId ? row.userHighId : row.userLowId))
        })
    }
}
