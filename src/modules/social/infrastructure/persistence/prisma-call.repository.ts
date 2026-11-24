import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { shownPerson } from '@/shared/domain'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import {
    Call,
    CallChanges,
    CallOutcome,
    CallPlan,
    CallRecord,
    CallRepositoryPort,
    CallStatus,
    ChangedCall
} from '../../domain'
import { lockCallers, Tx } from './social-locks'

const PERSON = { select: SHOWN_PERSON } as const

const CALL_ROW = {
    id: true,
    dmChannelId: true,
    callerId: true,
    calleeId: true,
    video: true,
    status: true,
    endReason: true,
    version: true,
    createdAt: true,
    acceptedAt: true,
    endedAt: true,
    caller: PERSON,
    callee: PERSON
} as const satisfies Prisma.CallSelect

type CallRow = Prisma.CallGetPayload<{ select: typeof CALL_ROW }>

const OPEN: CallStatus[] = ['ringing', 'active']

const toRecord = ({ caller, callee, ...row }: CallRow): CallRecord => ({
    ...row,
    caller: shownPerson(caller),
    callee: shownPerson(callee)
})

/** The columns an outcome sets; the version is raised with them. */
const columnsOf = (to: CallOutcome): Prisma.CallUpdateInput =>
    to.status === 'active'
        ? { status: 'active', acceptedAt: to.acceptedAt }
        : { status: to.status, endReason: to.endReason, endedAt: to.endedAt }

/**
 * The Call rows (D-242). A person's open calls are read through the
 * partial indexes Call_open_caller_idx and Call_open_callee_idx; a call's
 * times come from the app's clock, as messages' do, so its length and its
 * system message agree. Every change holds the locks of the people it is
 * about (lockCallers) and checks the version it read: a call changed by a
 * command that held no lock of its people would be a bug, and fails loudly
 * (P2025) rather than writing over it.
 */
@Injectable()
export class PrismaCallRepository implements CallRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async find(callId: string): Promise<CallRecord | null> {
        const row = await this.prisma.call.findUnique({ where: { id: callId }, select: CALL_ROW })
        return row && toRecord(row)
    }

    async openOf(userId: string): Promise<CallRecord[]> {
        return (await this.openOfAll(this.prisma, [userId])).map(toRecord)
    }

    async change(userIds: string[], decide: (open: Call[]) => CallPlan): Promise<CallChanges> {
        return this.prisma.$transaction(async (tx) => {
            await lockCallers(tx, userIds)
            const open = (await this.openOfAll(tx, userIds)).map(toRecord)
            const plan = decide(open)
            const changed: ChangedCall[] = []
            let madeId: string | null = null
            if (plan.create) {
                const { at, ...made } = plan.create
                const row = await tx.call.create({
                    data: { ...made, createdAt: at, endedAt: made.status === 'missed' ? at : null },
                    select: CALL_ROW
                })
                madeId = row.id
                changed.push({ call: toRecord(row), before: null })
            }
            for (const { call, to } of plan.changes) {
                const row = await tx.call.update({
                    where: { id: call.id, version: call.version },
                    data: { ...columnsOf(to), version: { increment: 1 } },
                    select: CALL_ROW
                })
                changed.push({ call: toRecord(row), before: call.status })
            }
            const answerId = plan.answer === 'new' ? madeId! : plan.answer
            const answer =
                changed.find(({ call }) => call.id === answerId)?.call ??
                open.find((call) => call.id === answerId) ??
                toRecord(await tx.call.findUniqueOrThrow({ where: { id: answerId }, select: CALL_ROW }))
            return { changed, answer }
        })
    }

    async ringingSince(before: Date): Promise<{ id: string; version: number }[]> {
        return this.prisma.call.findMany({
            where: { status: 'ringing', createdAt: { lt: before } },
            select: { id: true, version: true }
        })
    }

    /** The open calls of any of `userIds`, made or received, oldest first. */
    private openOfAll(db: Tx | PrismaService, userIds: string[]): Promise<CallRow[]> {
        return db.call.findMany({
            where: { status: { in: OPEN }, OR: [{ callerId: { in: userIds } }, { calleeId: { in: userIds } }] },
            orderBy: { createdAt: 'asc' },
            select: CALL_ROW
        })
    }
}
