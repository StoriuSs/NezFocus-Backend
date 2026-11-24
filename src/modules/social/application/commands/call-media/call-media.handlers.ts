import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { CALL_MEDIA, type CallMediaPort } from '@/modules/voice'
import { CALL_REPOSITORY, CallRepositoryPort, currentCallOf, decideEnd } from '../../../domain'
import { CALL_JOBS, CallJobsPort } from '../../ports'
import { checkMedia, MediaSources } from '../../services/call-room'
import { changeCalls, partyCallOf } from '../../services/change-calls'
import { CheckCallMediaCommand, EndActiveCallCommand, JoinCallCommand } from './call-media.commands'

/** What every handler of a call's media shares: the rows, the jobs, the bus, the room at LiveKit. */
abstract class CallMediaHandler {
    protected readonly sources: MediaSources

    constructor(
        @Inject(CALL_REPOSITORY) protected readonly calls: CallRepositoryPort,
        @Inject(CALL_JOBS) jobs: CallJobsPort,
        @Inject(CALL_MEDIA) protected readonly media: CallMediaPort,
        events: EventBus
    ) {
        this.sources = { calls, jobs, events, media }
    }
}

/**
 * Joining an active call's room (REQ-SOCIAL-05, D-239, D-246): its callee
 * right after answering, its caller once it is active, either again on a
 * reload within 30 seconds. A token for LiveKit, sending the microphone and
 * the camera, after leaving any voice room (one media connection per
 * account, D-210). A call ringing or over has no token: null, and the
 * route answers the call as it is. Not one of its two: not found.
 */
@CommandHandler(JoinCallCommand)
export class JoinCallHandler extends CallMediaHandler implements ICommandHandler<JoinCallCommand> {
    async execute({ userId, callId, sessionId }: JoinCallCommand): Promise<{ token: string; url: string } | null> {
        const call = await partyCallOf(this.calls, userId, callId)
        if (call.status !== 'active') return null
        return this.media.joinToken(callId, userId, sessionId)
    }
}

/**
 * The media job of an active call (D-242): nobody connected 15 seconds
 * after answering → failed, no length; somebody out 30 seconds → ended at
 * the time they left. Set for a version the call has moved on from, or a
 * deadline not reached: nothing.
 */
@CommandHandler(CheckCallMediaCommand)
export class CheckCallMediaHandler extends CallMediaHandler implements ICommandHandler<CheckCallMediaCommand> {
    async execute({ callId, version }: CheckCallMediaCommand): Promise<boolean> {
        return checkMedia(this.sources, callId, version, new Date())
    }
}

/**
 * Someone joining a voice room ends the active call they are in, as if
 * they hung up (D-242, D-246): `ended`, its message, its room closed. A
 * call they make still ringing, or calls ringing to them, are left.
 */
@CommandHandler(EndActiveCallCommand)
export class EndActiveCallHandler extends CallMediaHandler implements ICommandHandler<EndActiveCallCommand> {
    async execute({ userId }: EndActiveCallCommand): Promise<void> {
        const call = currentCallOf(await this.calls.openOf(userId), userId)
        if (call?.status !== 'active') return
        const now = new Date()
        await changeCalls(this.sources, [call.callerId, call.calleeId], (open) => decideEnd(call.id, userId, open, now))
    }
}

export const CALL_MEDIA_COMMAND_HANDLERS = [JoinCallHandler, CheckCallMediaHandler, EndActiveCallHandler]
