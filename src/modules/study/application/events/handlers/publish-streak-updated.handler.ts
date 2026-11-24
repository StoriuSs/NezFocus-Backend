import { Inject, Logger } from '@nestjs/common'
import { EventsHandler, IEventHandler } from '@nestjs/cqrs'
import { EVENT_PUBLISHER, EventPublisherPort } from '@/modules/realtime'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import {
    FALLBACK_TIME_ZONE,
    localDateOf,
    shownStreak,
    STUDY_STATS_REPOSITORY,
    StudyStatsRepositoryPort
} from '../../../domain'
import { ParticipationOpenedEvent } from '../participation-opened.event'
import { StudyCountedEvent } from '../study-counted.event'

/**
 * `streak.updated` to every socket of the person after each count and as a
 * participation of theirs opens (SRS 5.2, D-224, D-232): the streak shown
 * today, the longest, today's seconds and where the participation they are
 * in is counted up to, null once they are in none, and when that was read
 * (`readAt`: two reads may reach the client in either order). Read again after the
 * commit, from the same source as `GET /me/study-stats` (`todayOf`: the
 * seconds and the open participation in one query), so a count that closed
 * the participation says null, and one opened says where it starts. The
 * client adds the focus time running after that, so today's minutes and the
 * streak go up the moment they do (STUDY-07). A failed read is logged: the
 * next count tells again.
 *
 * A count is first told at once from its own numbers, before anything is
 * awaited (D-236): the change that counted publishes its `focus_session.*`
 * or `solo_session.updated` right after the count, and a client hearing the
 * phase move on before today's count would lose the focus just ended for a
 * moment (the number dips, the streak toast comes again). The read after
 * the commit follows and, read later, is the one the client keeps.
 */
@EventsHandler(StudyCountedEvent, ParticipationOpenedEvent)
export class PublishStreakUpdatedHandler implements IEventHandler<StudyCountedEvent | ParticipationOpenedEvent> {
    private readonly logger = new Logger(PublishStreakUpdatedHandler.name)

    constructor(
        @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisherPort,
        @Inject(STUDY_STATS_REPOSITORY) private readonly stats: StudyStatsRepositoryPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort
    ) {}

    async handle(event: StudyCountedEvent | ParticipationOpenedEvent): Promise<void> {
        if (event instanceof StudyCountedEvent) this.tellCount(event)
        const userIds = event instanceof StudyCountedEvent ? [event.count.userId] : [...new Set(event.userIds)]
        await Promise.all(userIds.map((userId) => this.tell(userId)))
    }

    private tellCount({ count }: StudyCountedEvent): void {
        this.publisher.toUser(count.userId, 'streak.updated', {
            current: count.shownStreak,
            longest: count.streak.longest,
            todaySeconds: count.todaySeconds,
            countedUntil: count.countedUntil,
            readAt: new Date()
        })
    }

    private async tell(userId: string): Promise<void> {
        try {
            const zone = (await this.users.timeZoneOf(userId)) ?? FALLBACK_TIME_ZONE
            const today = localDateOf(new Date(), zone)
            const [day, streak] = await Promise.all([this.stats.todayOf(userId, today), this.stats.streakOf(userId)])
            this.publisher.toUser(userId, 'streak.updated', {
                current: shownStreak(streak, today),
                longest: streak.longest,
                todaySeconds: day.seconds,
                countedUntil: day.countedUntil,
                readAt: day.readAt
            })
        } catch (error) {
            this.logger.error(`streak.updated for ${userId} not told: ${String(error)}`)
        }
    }
}
