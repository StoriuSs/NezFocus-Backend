import { Logger } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { Call, CallPlan, CallRecord, CallRepositoryPort, decideCutOff, RING_MS } from '../../domain'
import { CallChangedEvent } from '../events/call-changed.event'
import { CallJobsPort } from '../ports'

/** What changing calls needs: the rows, the timed jobs, the bus for the events after commit. */
export interface CallSources {
    calls: CallRepositoryPort
    jobs: CallJobsPort
    events: EventBus
}

const logger = new Logger('CallChanges')

/**
 * Runs a decision of call.rules under the locks of `userIds` (D-242), then,
 * after commit: each call made or changed is heard (CallChangedEvent), a
 * call made ringing gets its 45-second job, and one that stopped ringing
 * loses it. A job not set (Redis down) is logged, not thrown: the call is
 * written, and the sweep misses it in time (D-242). Answers the call the
 * command answers with, as it is now.
 */
export async function changeCalls(
    { calls, jobs, events }: CallSources,
    userIds: string[],
    decide: (open: Call[]) => CallPlan
): Promise<CallRecord> {
    const { changed, answer } = await calls.change(userIds, decide)
    for (const { call, before } of changed) {
        events.publish(new CallChangedEvent(call, before))
        try {
            if (before === null && call.status === 'ringing') {
                await jobs.ringOutAt(call.id, call.version, new Date(call.createdAt.getTime() + RING_MS))
            } else if (before === 'ringing') {
                // The version it rang at: every change raised it by one.
                await jobs.dropRingOut(call.id, call.version - 1)
            }
        } catch (error) {
            logger.warn(`The ring-out job of call ${call.id} not set or dropped: ${(error as Error)?.message}`)
        }
    }
    return answer
}

/**
 * Ends the open calls of `userId` (with `otherId` only, when given) from
 * outside (D-242): a block between the two, or `userId` starting to wait
 * for deletion. Each under the locks of its two, as decideCutOff says: one
 * over meanwhile is left as it is. One that fails is logged and the others
 * are still ended (an active call has no timer here to end it later).
 */
export async function cutOffCalls(
    sources: CallSources,
    userId: string,
    otherId: string | null,
    now: Date
): Promise<void> {
    for (const call of await sources.calls.openOf(userId)) {
        if (otherId && call.callerId !== otherId && call.calleeId !== otherId) continue
        try {
            await changeCalls(sources, [call.callerId, call.calleeId], (calls) => decideCutOff(call.id, calls, now))
        } catch (error) {
            logger.error(`Call ${call.id} not cut off: ${String(error)}`)
        }
    }
}
