import { EVERYONE_DEFAULT_PERMISSIONS } from '@/modules/permissions'
import { LayoutState, LayoutWrite, ServerNotFoundError } from '../../../domain'
import { ServerRepositoryPort } from '../../ports'
import { UpdateServerCommand } from './update-server.command'
import { UpdateServerHandler } from './update-server.handler'

/** The owner of ÔT, with no channel: a rename is all there is to decide. */
const STATE: LayoutState = {
    server: {
        id: 'ot',
        name: 'ÔT',
        iconKey: null,
        ownerId: 'an',
        welcomeChannelId: null,
        categories: [],
        channels: [],
        roles: [
            { id: 'e', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }
        ]
    },
    member: { userId: 'an', roleIds: [], timeoutUntil: null }
}

/** Runs the decision on STATE, as the repository would under its lock, and records the writes. */
function setUp(found = true) {
    const written: LayoutWrite[] = []
    const servers = {
        changeLayout: jest.fn(async (_serverId: string, _userId: string, decide: (s: LayoutState) => LayoutWrite[]) => {
            if (!found) return null
            written.push(...decide(STATE))
            return { createdId: null }
        })
    }
    const handler = new UpdateServerHandler(servers as unknown as ServerRepositoryPort)
    return { handler, servers, written }
}

describe('UpdateServerHandler', () => {
    it('decides the change under the server lock and carries out what it decided', async () => {
        const { handler, servers, written } = setUp()
        await handler.execute(new UpdateServerCommand('an', 'ot', { name: 'Ôn thi K22' }))
        expect(servers.changeLayout).toHaveBeenCalledWith('ot', 'an', expect.any(Function))
        expect(written).toEqual([{ kind: 'updateServer', changes: { name: 'Ôn thi K22' } }])
    })

    it('answers not found when the server is gone or they are not in it', async () => {
        const { handler } = setUp(false)
        await expect(handler.execute(new UpdateServerCommand('an', 'ot', { name: 'x y' }))).rejects.toBeInstanceOf(
            ServerNotFoundError
        )
    })
})
