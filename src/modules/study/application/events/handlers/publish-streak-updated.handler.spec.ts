import { Logger } from '@nestjs/common'
import { EventPublisherPort } from '@/modules/realtime'
import { UserDirectoryPort } from '@/modules/users'
import { StreakState, StudyStatsRepositoryPort, StudyToday } from '../../../domain'
import { ParticipationOpenedEvent } from '../participation-opened.event'
import { StudyCountedEvent } from '../study-counted.event'
import { PublishStreakUpdatedHandler } from './publish-streak-updated.handler'

/** 01:30 on the 21st in Hồ Chí Minh, still the 20th in UTC. */
const NOW = new Date('2026-11-20T18:30:00Z')
/** When the database read today's numbers. */
const READ = new Date('2026-11-20T18:30:00.123Z')

function setup(days: Record<string, StudyToday>, streak: StreakState, zones: Record<string, string | null> = {}) {
    const publisher = { toUser: jest.fn(), toChannel: jest.fn(), toServer: jest.fn() }
    const stats = {
        todayOf: jest.fn(async (userId: string) => {
            const day = days[userId]
            if (!day) throw new Error('database gone')
            return day
        }),
        streakOf: jest.fn(async () => streak)
    }
    const users = { timeZoneOf: jest.fn(async (userId: string) => zones[userId] ?? null) }
    const handler = new PublishStreakUpdatedHandler(
        publisher as unknown as EventPublisherPort,
        stats as unknown as StudyStatsRepositoryPort,
        users as unknown as UserDirectoryPort
    )
    return { handler, publisher, stats }
}

const count = (userId: string, countedUntil: Date) =>
    new StudyCountedEvent({
        userId,
        sessionId: 's1',
        added: 480,
        seconds: 1080,
        countedUntil,
        todaySeconds: 1080,
        streak: { current: 4, longest: 9, lastQualifiedDate: '2026-11-19' },
        shownStreak: 4
    })

describe('PublishStreakUpdatedHandler (REQ-STUDY-07, D-224, D-232)', () => {
    beforeEach(() => jest.useFakeTimers({ now: NOW }))
    afterEach(() => jest.useRealTimers())

    it('tells every socket of the person, and no one else, the streak shown today, today’s seconds and where they are counted up to', async () => {
        const countedUntil = new Date('2026-11-20T13:25:00Z')
        const { handler, publisher, stats } = setup(
            { an: { seconds: 1080, countedUntil, readAt: READ } },
            // Its last day the 19th: yesterday in UTC, the day before yesterday in Hồ Chí Minh, so shown as 0 there.
            { current: 4, longest: 9, lastQualifiedDate: '2026-11-19' },
            { an: 'Asia/Ho_Chi_Minh' }
        )

        await handler.handle(count('an', countedUntil))

        // Today in the person's zone, not the server's.
        expect(stats.todayOf).toHaveBeenCalledWith('an', '2026-11-21')
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'streak.updated', {
            current: 0,
            longest: 9,
            todaySeconds: 1080,
            countedUntil,
            // When it was read: of two reads, the client keeps the later (D-232).
            readAt: READ
        })
        expect(publisher.toChannel).not.toHaveBeenCalled()
        expect(publisher.toServer).not.toHaveBeenCalled()
    })

    it('tells the count’s own numbers at once, before reading again: they reach the client ahead of the session’s change (D-236)', async () => {
        const countedUntil = new Date('2026-11-20T13:25:00Z')
        const { handler, publisher } = setup(
            { an: { seconds: 1080, countedUntil, readAt: READ } },
            { current: 4, longest: 9, lastQualifiedDate: '2026-11-19' }
        )

        const reading = handler.handle(count('an', countedUntil))

        // Before any read: the same tick as the publish of the count, so ahead of focus_session.* (published after it).
        expect(publisher.toUser).toHaveBeenCalledTimes(1)
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'streak.updated', {
            current: 4,
            longest: 9,
            todaySeconds: 1080,
            countedUntil,
            readAt: NOW
        })
        await reading
        // Then read again, later, which the client keeps (D-232).
        expect(publisher.toUser).toHaveBeenCalledTimes(2)
        expect(publisher.toUser).toHaveBeenLastCalledWith(
            'an',
            'streak.updated',
            expect.objectContaining({ readAt: READ })
        )
    })

    it('says null once the count closed the participation (left, the session ended): in no session now', async () => {
        const { handler, publisher } = setup(
            { an: { seconds: 1500, countedUntil: null, readAt: READ } },
            { current: 6, longest: 9, lastQualifiedDate: '2026-11-20' }
        )

        await handler.handle(count('an', new Date('2026-11-20T13:29:00Z')))

        expect(publisher.toUser).toHaveBeenCalledWith('an', 'streak.updated', {
            current: 6,
            longest: 9,
            todaySeconds: 1500,
            countedUntil: null,
            readAt: READ
        })
    })

    it('tells each one whose participation opened where it is counted from; a failed read leaves the others told', async () => {
        const opened = new Date('2026-11-20T13:30:00Z')
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const { handler, publisher } = setup(
            {
                an: { seconds: 840, countedUntil: opened, readAt: READ },
                binh: { seconds: 0, countedUntil: opened, readAt: READ }
            },
            { current: 5, longest: 5, lastQualifiedDate: '2026-11-19' }
        )

        await handler.handle(new ParticipationOpenedEvent(['an', 'binh', 'chi']))

        expect(publisher.toUser).toHaveBeenCalledTimes(2)
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'streak.updated', {
            current: 5,
            longest: 5,
            todaySeconds: 840,
            countedUntil: opened,
            readAt: READ
        })
        expect(publisher.toUser).toHaveBeenCalledWith(
            'binh',
            'streak.updated',
            expect.objectContaining({ todaySeconds: 0 })
        )
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('chi'))
        logged.mockRestore()
    })
})
