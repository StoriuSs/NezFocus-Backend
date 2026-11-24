import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { CALL_REPOSITORY, CallRepositoryPort } from '../../../domain'
import { CALL_JOBS, CallJobsPort } from '../../ports'
import { CallSources, cutOffCalls } from '../../services/change-calls'
import { RelationshipChangedEvent } from '../relationship-changed.event'

/**
 * A block ends the call between the two at once, whoever blocked whom
 * (D-242, spec 09: active, it ends as any call does, nobody told why;
 * ringing, it is missed). Unfriending does not: a call goes on until one
 * hangs up. A failure is logged: the block is written either way, and a
 * new call is refused across it.
 */
@EventsHandler(RelationshipChangedEvent)
export class EndBlockedCallsHandler implements IEventHandler<RelationshipChangedEvent> {
    private readonly logger = new Logger(EndBlockedCallsHandler.name)
    private readonly sources: CallSources

    constructor(
        @Inject(CALL_REPOSITORY) calls: CallRepositoryPort,
        @Inject(CALL_JOBS) jobs: CallJobsPort,
        events: EventBus
    ) {
        this.sources = { calls, jobs, events }
    }

    async handle({ actorId, otherId, write }: RelationshipChangedEvent): Promise<void> {
        if (write.write !== 'block') return
        try {
            await cutOffCalls(this.sources, actorId, otherId, new Date())
        } catch (error) {
            this.logger.error(`Could not end the calls between ${actorId} and ${otherId} after a block`, error)
        }
    }
}
