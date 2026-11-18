import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { NOTIFIER, NotifierPort } from '@/modules/notifications'
import { TaskDeletedEvent } from '../task-deleted.event'

/**
 * A task deleted takes its inbox items with it in the same transaction
 * (D-98); its creator and all ever put on it hear of it through NOTIFIER,
 * with their unread count now (D-200). A failure is logged: the items are
 * gone, and the badge is right again at the next read of the inbox.
 */
@EventsHandler(TaskDeletedEvent)
export class NotifyDeletedTaskHandler implements IEventHandler<TaskDeletedEvent> {
    private readonly logger = new Logger(NotifyDeletedTaskHandler.name)

    constructor(@Inject(NOTIFIER) private readonly notifier: NotifierPort) {}

    async handle({ taskId, peopleIds }: TaskDeletedEvent): Promise<void> {
        try {
            await this.notifier.taskDeleted(taskId, peopleIds)
        } catch (error) {
            this.logger.error(`Could not tell ${peopleIds.length} people that task ${taskId} went`, error)
        }
    }
}
