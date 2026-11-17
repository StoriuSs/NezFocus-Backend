import { EventPublisherPort } from '@/modules/realtime'
import { NotificationsCreatedEvent } from '../notifications-created.event'
import { NotificationsDeletedEvent } from '../notifications-deleted.event'
import { NotificationsReadEvent } from '../notifications-read.event'
import { PublishCreatedNotificationsHandler } from './publish-created-notifications.handler'
import { PublishDeletedNotificationsHandler } from './publish-deleted-notifications.handler'
import { PublishReadNotificationsHandler } from './publish-read-notifications.handler'

describe('notification.* to each person’s tabs (SRS 5.2)', () => {
    const publisher = () => ({ toUser: jest.fn() }) as unknown as EventPublisherPort & { toUser: jest.Mock }

    it('sends each person their own new item', () => {
        const to = publisher()
        const item = { id: 'n1' } as never
        new PublishCreatedNotificationsHandler(to).handle(
            new NotificationsCreatedEvent([
                { userId: 'binh', notification: item },
                { userId: 'chi', notification: item }
            ])
        )
        expect(to.toUser.mock.calls).toEqual([
            ['binh', 'notification.created', { notification: item }],
            ['chi', 'notification.created', { notification: item }]
        ])
    })

    it('sends what was read and the count left', () => {
        const to = publisher()
        new PublishReadNotificationsHandler(to).handle(new NotificationsReadEvent('binh', null, 'n9', 2))
        expect(to.toUser).toHaveBeenCalledWith('binh', 'notification.read', {
            ids: null,
            beforeId: 'n9',
            unreadCount: 2
        })
    })

    it('sends each person the items they lost', () => {
        const to = publisher()
        new PublishDeletedNotificationsHandler(to).handle(
            new NotificationsDeletedEvent([{ userId: 'binh', ids: ['n1'], unreadCount: 0 }])
        )
        expect(to.toUser).toHaveBeenCalledWith('binh', 'notification.deleted', { ids: ['n1'], unreadCount: 0 })
    })
})
