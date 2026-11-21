import { Inject } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { StudyCountedEvent } from '../study-counted.event'

/**
 * `streak.updated` to every socket of the person after each count (SRS 5.2,
 * D-224): the streak shown today, the longest, today's seconds and where they
 * are counted up to. The client adds the focus time running after that, so
 * today's minutes and the streak go up the moment they do (STUDY-07).
 */
@EventsHandler(StudyCountedEvent)
export class PublishStreakUpdatedHandler implements IEventHandler<StudyCountedEvent> {
    constructor(@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort) {}

    handle({ count }: StudyCountedEvent): void {
        this.publisher.toUser(count.userId, 'streak.updated', {
            current: count.shownStreak,
            longest: count.streak.longest,
            todaySeconds: count.todaySeconds,
            countedUntil: count.countedUntil
        })
    }
}
