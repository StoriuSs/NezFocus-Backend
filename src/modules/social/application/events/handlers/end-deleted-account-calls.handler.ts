import { Inject, Logger } from '@nestjs/common'
import { EventBus, EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { AccountDeletionRequestedEvent } from '@/modules/auth'
import { CALL_REPOSITORY, CallRepositoryPort } from '../../../domain'
import { CALL_JOBS, CallJobsPort } from '../../ports'
import { CallSources, cutOffCalls } from '../../services/change-calls'

/**
 * An account that started to wait for deletion (REQ-AUTH-09) leaves its
 * calls at once (D-242): the other one sees "Cuộc gọi đã kết thúc", and the
 * DM's message is written as for any end (spec 09 `deleted-account`). A
 * failure is logged: its sessions ended, so its tabs leave the call.
 */
@EventsHandler(AccountDeletionRequestedEvent)
export class EndDeletedAccountCallsHandler implements IEventHandler<AccountDeletionRequestedEvent> {
    private readonly logger = new Logger(EndDeletedAccountCallsHandler.name)
    private readonly sources: CallSources

    constructor(
        @Inject(CALL_REPOSITORY) calls: CallRepositoryPort,
        @Inject(CALL_JOBS) jobs: CallJobsPort,
        events: EventBus
    ) {
        this.sources = { calls, jobs, events }
    }

    async handle({ userId }: AccountDeletionRequestedEvent): Promise<void> {
        try {
            await cutOffCalls(this.sources, userId, null, new Date())
        } catch (error) {
            this.logger.error(`Could not end the calls of ${userId}, waiting for deletion`, error)
        }
    }
}
