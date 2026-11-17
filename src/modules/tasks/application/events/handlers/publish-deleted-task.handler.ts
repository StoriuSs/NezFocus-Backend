import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { TaskDeletedEvent } from '../task-deleted.event'

/** `task.deleted` to every socket that may view the channel (SRS 5.2): its id, which each client drops. */
@EventsHandler(TaskDeletedEvent)
export class PublishDeletedTaskHandler implements IEventHandler<TaskDeletedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ taskId, channelId }: TaskDeletedEvent): void {
        this.publisher.toChannel(channelId, 'task.deleted', { taskId, channelId })
    }
}
