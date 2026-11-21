import { EventPublisherPort } from '@/modules/realtime'
import { StudyCountedEvent } from '../study-counted.event'
import { PublishStreakUpdatedHandler } from './publish-streak-updated.handler'

describe('PublishStreakUpdatedHandler (REQ-STUDY-07, D-224)', () => {
    it('tells every socket of the person, and no one else, the streak shown today, today’s seconds and where they are counted up to', () => {
        const publisher = { toUser: jest.fn(), toChannel: jest.fn(), toServer: jest.fn() }
        const countedUntil = new Date('2026-11-20T13:25:00Z')

        new PublishStreakUpdatedHandler(publisher as unknown as EventPublisherPort).handle(
            new StudyCountedEvent({
                userId: 'an',
                sessionId: 's1',
                added: 480,
                seconds: 1080,
                countedUntil,
                todaySeconds: 1080,
                // Stored as a run up to the day before yesterday: shown as 0.
                streak: { current: 4, longest: 9, lastQualifiedDate: '2026-11-18' },
                shownStreak: 0
            })
        )

        expect(publisher.toUser).toHaveBeenCalledWith('an', 'streak.updated', {
            current: 0,
            longest: 9,
            todaySeconds: 1080,
            countedUntil
        })
        expect(publisher.toChannel).not.toHaveBeenCalled()
        expect(publisher.toServer).not.toHaveBeenCalled()
    })
})
