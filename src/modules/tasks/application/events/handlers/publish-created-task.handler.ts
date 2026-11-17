import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { TaskCreatedEvent } from '../task-created.event'

/**
 * `task.created` to every socket that may view the channel (SRS 5.2, D-163):
 * the whole task, which each board puts in its place. A board that is off
 * shows no task, so a client with it closed has nothing to do with it.
 */
@EventsHandler(TaskCreatedEvent)
export class PublishCreatedTaskHandler implements IEventHandler<TaskCreatedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ task }: TaskCreatedEvent): void {
        this.publisher.toChannel(task.channelId, 'task.created', { task })
    }
}
