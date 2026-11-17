import { notificationWorld } from '../../notification-test-world.shared-spec'
import { CleanUpNotificationsCommand } from './clean-up-notifications.command'
import { CLEAN_UP_BATCH, CleanUpNotificationsHandler } from './clean-up-notifications.handler'

describe('CleanUpNotificationsHandler (REQ-NOTIF-03)', () => {
    const now = new Date('2026-11-17T12:00:00.000Z')
    const at = (days: number) => new Date(now.getTime() - days * 86_400_000)

    it('deletes every item older than 90 days, read or not, a batch at a time, and keeps the rest', async () => {
        const world = notificationWorld()
        for (let index = 0; index < CLEAN_UP_BATCH + 2; index++) {
            world.seed({ userId: 'binh', messageId: `old${index}`, createdAt: at(91), readAt: index % 2 ? now : null })
        }
        world.seed({ userId: 'binh', messageId: 'kept', createdAt: at(90) })

        const deleted = await new CleanUpNotificationsHandler(world.repository).execute(
            new CleanUpNotificationsCommand(now)
        )
        expect(deleted).toBe(CLEAN_UP_BATCH + 2)
        expect(world.rows.map((row) => row.messageId)).toEqual(['kept'])
        expect(world.repository.removeOlderThan).toHaveBeenCalledTimes(2)
    })
})
