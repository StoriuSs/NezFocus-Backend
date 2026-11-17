import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { MemberChangedEvent } from '@/modules/servers'
import { TASK_JOBS, TaskJobsPort } from '../../ports'

/**
 * A member who left a server, by themselves, kicked, banned or as a deleted
 * account, comes off its tasks (REQ-TASK-04, D-195): queued, not done here,
 * as a failed event handler is never run again (D-181). The job runs
 * UnassignLeftMemberCommand.
 */
@EventsHandler(MemberChangedEvent)
export class UnassignLeftMemberLaterHandler implements IEventHandler<MemberChangedEvent> {
    private readonly logger = new Logger(UnassignLeftMemberLaterHandler.name)

    constructor(@Inject(TASK_JOBS) private readonly jobs: TaskJobsPort) {}

    async handle({ serverId, userId, action }: MemberChangedEvent): Promise<void> {
        if (action !== 'left') return
        await this.jobs.unassignLeftMemberLater(serverId, userId, new Date()).catch((error: unknown) => {
            // Lost once the leave has answered: whom to take off by hand.
            this.logger.error(
                `${userId}, who left server ${serverId}, not queued to come off its tasks: ${String(error)}`
            )
            throw error
        })
    }
}
