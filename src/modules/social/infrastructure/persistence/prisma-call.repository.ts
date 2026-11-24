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
    CallPresence,
    CallRecord,
    CallRepositoryPort,
    CallStatus,
    ChangedCall,
    MediaRecorded,
    MediaWrite,
    SessionConnection
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

const PRESENCE_ROW = {
    userId: true,
    participantSid: true,
    joinedAt: true,
    leftAt: true,
    sessionId: true
} as const satisfies Prisma.CallParticipantSelect

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

    async activeCalls(): Promise<Call[]> {
        const rows = await this.prisma.call.findMany({ where: { status: 'active' }, select: CALL_ROW })
        return rows.map(toRecord)
    }

    async inActiveCalls(userIds: string[]): Promise<string[]> {
        if (userIds.length === 0) return []
        // `active` is one of the open statuses: the partial indexes Call_open_caller_idx / _callee_idx serve it.
        const rows = await this.prisma.call.findMany({
            where: { status: 'active', OR: [{ callerId: { in: userIds } }, { calleeId: { in: userIds } }] },
            select: { callerId: true, calleeId: true }
        })
        const asked = new Set(userIds)
        return [...new Set(rows.flatMap((row) => [row.callerId, row.calleeId]))].filter((userId) => asked.has(userId))
    }

    async presenceOf(callIds: string[]): Promise<Map<string, CallPresence[]>> {
        const byCall = new Map<string, CallPresence[]>(callIds.map((callId) => [callId, []]))
        if (callIds.length === 0) return byCall
        const rows = await this.prisma.callParticipant.findMany({
            where: { callId: { in: callIds } },
            select: { callId: true, ...PRESENCE_ROW }
        })
        for (const { callId, ...row } of rows) byCall.get(callId)!.push(row)
        return byCall
    }

    async recordMedia(
        callId: string,
        decide: (call: Call | null, presence: CallPresence[]) => MediaWrite
    ): Promise<MediaRecorded> {
        const people = await this.prisma.call.findUnique({
            where: { id: callId },
            select: { callerId: true, calleeId: true }
        })
        if (!people) return { call: null, presence: [], written: false, ...decide(null, []) }
        return this.prisma.$transaction(async (tx) => {
            await lockCallers(tx, [people.callerId, people.calleeId])
            const call = toRecord(await tx.call.findUniqueOrThrow({ where: { id: callId }, select: CALL_ROW }))
            const presence = await tx.callParticipant.findMany({ where: { callId }, select: PRESENCE_ROW })
            const { write, evict } = decide(call, presence)
            if (!write) return { call, presence, written: false, evict }
            const { userId, ...columns } = write
            await tx.callParticipant.upsert({
                where: { callId_userId: { callId, userId } },
                create: { callId, ...write },
                update: columns
            })
            const after = await tx.call.update({
                where: { id: callId, version: call.version },
                data: { version: { increment: 1 } },
                select: CALL_ROW
            })
            return {
                call: toRecord(after),
                presence: [...presence.filter((row) => row.userId !== userId), write],
                written: true,
                evict
            }
        })
    }

    async inSessions(sessionIds: string[]): Promise<SessionConnection[]> {
        if (sessionIds.length === 0) return []
        const rows = await this.prisma.callParticipant.findMany({
            where: { sessionId: { in: sessionIds }, leftAt: null, call: { status: 'active' } },
            select: { callId: true, ...PRESENCE_ROW }
        })
        return rows.map(({ callId, ...row }) => ({ callId, row }))
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
