import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { MembershipPort } from '@/modules/servers'
import { PrincipalPort } from '@/modules/auth'
import { TicketInvalidError } from '@/modules/realtime/domain/errors/ticket.errors'
import { TicketHolder, TicketStorePort } from '../../ports'
import { OpenConnectionCommand } from './open-connection.command'
import { OpenConnectionHandler } from './open-connection.handler'

const AN = 'user-an'
const SESSION = 'session-1'

/**
 * One server An is a member of: a public text channel, a private one for the
 * `mod` role only, a voice room, and a read-only (managers) text channel.
 * Which channels make rooms is the domain's serverRooms (rooms.spec.ts).
 */
const study: AccessServer = {
    ownerId: 'someone-else',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'mod', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false }
    ],
    channels: [
        { id: 'general', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'staff', type: 'text', isPrivate: true, viewRoleIds: ['mod'], sendMode: 'everyone' },
        { id: 'lounge', type: 'voice', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'news', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'managers' }
    ]
}

function setup(options: { holder?: TicketHolder | null; servers?: string[]; revoked?: Error } = {}) {
    const redeemed: string[] = []
    const tickets: TicketStorePort = {
        issue: async () => 'unused',
        redeem: async (ticket) => {
            redeemed.push(ticket)
            return options.holder === undefined ? { userId: AN, sessionId: SESSION } : options.holder
        }
    }
    const principals: PrincipalPort = {
        resolve: async () => {
            if (options.revoked) throw options.revoked
            return { user: { id: AN } as never, sessionId: SESSION }
        }
    }
    const membership: MembershipPort = { serverIdsOf: async () => options.servers ?? ['study', 'left'] }
    // `left`: listed a moment ago, gone by the time it is checked.
    const checker: PermissionCheckerPort = {
        access: async (serverId) =>
            serverId === 'study' ? { server: study, member: { userId: AN, roleIds: [], timeoutUntil: null } } : null
    }
    const handler = new OpenConnectionHandler(tickets, principals, membership, checker)
    return { handler, redeemed }
}

describe('Opening a realtime connection', () => {
    it('spends the ticket and puts the socket in its user, session, server and viewable text channel rooms', async () => {
        const { handler, redeemed } = setup()

        const opened = await handler.execute(new OpenConnectionCommand('ticket-1'))

        expect(redeemed).toEqual(['ticket-1'])
        expect(opened.userId).toBe(AN)
        expect(opened.sessionId).toBe(SESSION)
        expect(opened.rooms.sort()).toEqual(
            ['user:user-an', 'session:session-1', 'server:study', 'channel:general', 'channel:news'].sort()
        )
    })

    it('leaves out a private channel, a voice room, and a server it is no longer in (D-163)', async () => {
        const { handler } = setup()

        const { rooms } = await handler.execute(new OpenConnectionCommand('ticket-1'))

        expect(rooms).not.toContain('channel:staff')
        expect(rooms).not.toContain('channel:lounge')
        expect(rooms).not.toContain('server:left')
    })

    it('refuses a ticket the store does not know, or knows no longer', async () => {
        const { handler } = setup({ holder: null })

        await expect(handler.execute(new OpenConnectionCommand('used-or-made-up'))).rejects.toBeInstanceOf(
            TicketInvalidError
        )
    })

    it('refuses an empty ticket without asking the store', async () => {
        const { handler, redeemed } = setup()

        await expect(handler.execute(new OpenConnectionCommand(''))).rejects.toBeInstanceOf(TicketInvalidError)
        expect(redeemed).toEqual([])
    })

    it('refuses a ticket whose session ended after it was bought', async () => {
        const ended = new Error('This session has ended. Sign in again.')
        const { handler } = setup({ revoked: ended })

        await expect(handler.execute(new OpenConnectionCommand('ticket-1'))).rejects.toBe(ended)
    })

    it('opens with only its own rooms when it is in no server', async () => {
        const { handler } = setup({ servers: [] })

        const { rooms } = await handler.execute(new OpenConnectionCommand('ticket-1'))

        expect(rooms.sort()).toEqual(['session:session-1', 'user:user-an'])
    })
})
