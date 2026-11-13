import { TicketInvalidError, TicketsUnavailableError } from '@/modules/realtime/domain'
import { IssueTicketCommand, IssueTicketHandler, TicketHolder, TicketStorePort } from '@/modules/realtime/application'

function setup(options: { storeDown?: boolean } = {}) {
    const sold: TicketHolder[] = []
    const tickets: TicketStorePort = {
        issue: async (holder) => {
            if (options.storeDown) throw new TicketsUnavailableError()
            sold.push(holder)
            return 'ticket-1'
        },
        redeem: async () => null
    }
    return { handler: new IssueTicketHandler(tickets), sold }
}

describe('Buying a realtime ticket (D-13)', () => {
    it('sells one to the session the request came in, spendable for 30 seconds', async () => {
        const { handler, sold } = setup()

        const issued = await handler.execute(new IssueTicketCommand('user-an', 'session-1'))

        expect(issued).toEqual({ ticket: 'ticket-1', expiresInSeconds: 30 })
        expect(sold).toEqual([{ userId: 'user-an', sessionId: 'session-1' }])
    })

    it('says the service is unavailable when the store cannot be reached', async () => {
        const { handler } = setup({ storeDown: true })

        await expect(handler.execute(new IssueTicketCommand('user-an', 'session-1'))).rejects.toMatchObject({
            kind: 'unavailable',
            errorKey: 'SERVICE_UNAVAILABLE'
        })
    })
})

describe('A refused ticket', () => {
    it('has a code of its own, in the realtime hundred: the client buys a new one and tries again', () => {
        expect(new TicketInvalidError()).toMatchObject({ kind: 'unauthenticated', errorKey: 'REALTIME_TICKET_INVALID' })
    })
})
