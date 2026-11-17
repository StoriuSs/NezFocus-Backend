import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { TaskUpdatedEvent } from '../task-updated.event'

/** `task.updated` to every socket that may view the channel (SRS 5.2): the task as it now is, which each client swaps in. */
@EventsHandler(TaskUpdatedEvent)
export class PublishUpdatedTaskHandler implements IEventHandler<TaskUpdatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ task }: TaskUpdatedEvent): void {
        this.publisher.toChannel(task.channelId, 'task.updated', { task })
    }
}
