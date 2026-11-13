import { SessionsEndedEvent } from '@/modules/auth'
import { DisconnectEndedSessionsHandler, EventPublisherPort } from '@/modules/realtime/application'

describe('When sessions end', () => {
    it('cuts off their sockets, after telling them why (ARCHITECTURE 3.1 step 5)', () => {
        const ended: string[][] = []
        const publisher = { endSessions: (ids: string[]) => void ended.push(ids) } as unknown as EventPublisherPort

        new DisconnectEndedSessionsHandler(publisher).handle(new SessionsEndedEvent(['s1', 's2']))

        expect(ended).toEqual([['s1', 's2']])
    })
})
