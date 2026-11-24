import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    CALL_REPOSITORY,
    CallNotFoundError,
    CallRecord,
    CallRepositoryPort,
    CannotMessageUserError,
    decideAccept,
    decideCutOff,
    decideDecline,
    decideEnd,
    decideRingOut,
    decideStart,
    DM_REPOSITORY,
    DmNotFoundError,
    DmRepositoryPort,
    isOpenCall,
    RELATIONSHIP_REPOSITORY,
    RelationshipRepositoryPort,
    RING_MS
} from '../../../domain'
import { CALL_JOBS, CallJobsPort } from '../../ports'
import { CallSources, changeCalls } from '../../services/change-calls'
import { mayReach, ReachSources, recipientOf } from '../../services/dm-reach'
import {
    AcceptCallCommand,
    DeclineCallCommand,
    EndCallCommand,
    RingOutCallCommand,
    StartCallCommand,
    SweepCallTimersCommand
} from './call.commands'

/** What every call handler shares: the rows, the jobs, the bus; DMs and who may reach whom, for calling and answering. */
abstract class CallHandler {
    protected readonly sources: CallSources
    protected readonly reach: ReachSources

    constructor(
        @Inject(CALL_REPOSITORY) protected readonly calls: CallRepositoryPort,
        @Inject(CALL_JOBS) jobs: CallJobsPort,
        @Inject(DM_REPOSITORY) protected readonly dms: DmRepositoryPort,
        @Inject(RELATIONSHIP_REPOSITORY) relationships: RelationshipRepositoryPort,
        @Inject(MEMBERSHIP) membership: MembershipPort,
        @Inject(USER_DIRECTORY) protected readonly users: UserDirectoryPort,
        events: EventBus
    ) {
        this.sources = { calls, jobs, events }
        this.reach = { relationships, membership, users }
    }

    /** The call, when `userId` is one of its two; not found otherwise, the same as none (NFR-SEC-05). */
    protected async callOf(userId: string, callId: string): Promise<CallRecord> {
        const call = await this.calls.find(callId)
        if (!call || (call.callerId !== userId && call.calleeId !== userId)) throw new CallNotFoundError(callId)
        return call
    }

    /** Whether `userId` may message the other one now: calling and answering are messaging (REQ-SOCIAL-05, D-242). */
    protected async mayCall(userId: string, otherId: string): Promise<boolean> {
        const recipient = await recipientOf(this.users, userId, otherId)
        return !!recipient && (await mayReach(this.reach, userId, recipient))
    }
}

/**
 * Calling the other one of my DM (REQ-SOCIAL-05, D-120, D-242, D-245):
 * only someone I may message (CANNOT_MESSAGE_USER otherwise, the same for
 * every reason, "Không thể gọi cho người dùng này"); then decideStart under
 * the locks of the two: it rings, or is missed at once when they are busy,
 * or answers the call they make to me in this DM; me in another call:
 * CALL_IN_PROGRESS. Not my DM, or no DM: not found.
 *
 * Who may call is asked again once the call is written: a block committed
 * between the first check and the write ends no call (its handler read the
 * open calls before this one was there), so the call this one made or
 * answered is cut off now (D-242), as the block's handler would have.
 */
@CommandHandler(StartCallCommand)
export class StartCallHandler extends CallHandler implements ICommandHandler<StartCallCommand> {
    async execute({ userId, dmChannelId, video }: StartCallCommand): Promise<{ callId: string }> {
        const pair = await this.dms.find(dmChannelId)
        if (!pair?.userIds.includes(userId)) throw new DmNotFoundError(dmChannelId)
        const otherId = pair.userIds.find((id) => id !== userId)!
        if (!(await this.mayCall(userId, otherId))) throw new CannotMessageUserError(otherId)
        const now = new Date()
        const request = { dmChannelId, callerId: userId, calleeId: otherId, video }
        const call = await changeCalls(this.sources, [userId, otherId], (open) => decideStart(request, open, now))
        if (isOpenCall(call) && !(await this.mayCall(userId, otherId))) {
            const at = new Date()
            await changeCalls(this.sources, [userId, otherId], (open) => decideCutOff(call.id, open, at))
        }
        return { callId: call.id }
    }
}

/**
 * Answering a call ringing to me (REQ-SOCIAL-05): active now, the other
 * calls ringing to me missed as busy (D-120). One I may no longer message
 * (blocked meanwhile, out of the server we shared) is refused like a call
 * (CANNOT_MESSAGE_USER), and rings out. A call that changed meanwhile (its
 * caller hung up, another tab answered) answers as it is (D-245).
 */
@CommandHandler(AcceptCallCommand)
export class AcceptCallHandler extends CallHandler implements ICommandHandler<AcceptCallCommand> {
    async execute({ userId, callId }: AcceptCallCommand): Promise<void> {
        const call = await this.callOf(userId, callId)
        if (call.status === 'ringing' && call.calleeId === userId && !(await this.mayCall(userId, call.callerId))) {
            throw new CannotMessageUserError(call.callerId)
        }
        const now = new Date()
        await changeCalls(this.sources, [call.callerId, call.calleeId], (open) =>
            decideAccept(callId, userId, open, now)
        )
    }
}

/** Declining a call ringing to me (REQ-SOCIAL-05): no inbox item (SOCIAL-06). Anything else answers as it is (D-245). */
@CommandHandler(DeclineCallCommand)
export class DeclineCallHandler extends CallHandler implements ICommandHandler<DeclineCallCommand> {
    async execute({ userId, callId }: DeclineCallCommand): Promise<void> {
        const call = await this.callOf(userId, callId)
        const now = new Date()
        await changeCalls(this.sources, [call.callerId, call.calleeId], (open) =>
            decideDecline(callId, userId, open, now)
        )
    }
}

/**
 * Hanging up (D-242): ringing, its caller cancels it (missed, an inbox item
 * for the callee) and its callee declines it; active, it ends. Over
 * already: it answers as it is (D-245).
 */
@CommandHandler(EndCallCommand)
export class EndCallHandler extends CallHandler implements ICommandHandler<EndCallCommand> {
    async execute({ userId, callId }: EndCallCommand): Promise<void> {
        const call = await this.callOf(userId, callId)
        const now = new Date()
        await changeCalls(this.sources, [call.callerId, call.calleeId], (open) => decideEnd(callId, userId, open, now))
    }
}

/** 45 seconds of ringing (REQ-SOCIAL-05): missed (`no_answer`) if it still rings at `version`; else nothing. */
@CommandHandler(RingOutCallCommand)
export class RingOutCallHandler extends CallHandler implements ICommandHandler<RingOutCallCommand> {
    async execute({ callId, version }: RingOutCallCommand): Promise<boolean> {
        return ringOut(this.sources, callId, version, new Date())
    }
}

/** Misses `callId` if it still rings at `version`; true when this run did. A call gone (its DM deleted with an account) is left. */
async function ringOut(sources: CallSources, callId: string, version: number, now: Date): Promise<boolean> {
    const call = await sources.calls.find(callId)
    if (!call || call.status !== 'ringing' || call.version !== version) return false
    const after = await changeCalls(sources, [call.callerId, call.calleeId], (open) =>
        decideRingOut(callId, version, open, now)
    )
    // Missed by this run, not by a hang-up that came first: only then was a job lost or late.
    return after.endReason === 'no_answer' && after.version === version + 1
}

/**
 * The calls still ringing 45 seconds on whose job was lost (Redis down when
 * it was set, the app stopped between the commit and setting it) or is
 * late (D-242), each missed as its job would: a job that comes meanwhile
 * finds it done. Without it, a lost job would keep its two people busy for
 * good. One that fails is logged and left for the next run. Returns how
 * many it missed.
 */
@CommandHandler(SweepCallTimersCommand)
export class SweepCallTimersHandler extends CallHandler implements ICommandHandler<SweepCallTimersCommand> {
    private readonly logger = new Logger(SweepCallTimersHandler.name)

    async execute({ now }: SweepCallTimersCommand): Promise<number> {
        let missed = 0
        for (const { id, version } of await this.calls.ringingSince(new Date(now.getTime() - RING_MS))) {
            try {
                if (await ringOut(this.sources, id, version, now)) missed++
            } catch (error) {
                this.logger.error(`The ring-out of call ${id} failed: ${String(error)}`)
            }
        }
        // Each is a job lost or late: worth seeing.
        if (missed > 0) this.logger.warn(`${missed} calls missed by the sweep (their job lost or late)`)
        return missed
    }
}

export const CALL_COMMAND_HANDLERS = [
    StartCallHandler,
    AcceptCallHandler,
    DeclineCallHandler,
    EndCallHandler,
    RingOutCallHandler,
    SweepCallTimersHandler
]
