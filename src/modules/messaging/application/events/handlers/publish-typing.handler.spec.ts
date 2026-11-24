import { dms } from '../../dm-test-world.shared-spec'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort, TypingSignalledEvent } from '@/modules/realtime'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import { LimitsUnavailableError } from '@/shared/domain'
import { SendLimitPort } from '../../ports'
import { TYPING_PER_TAB } from '../../rate-limits'
import { PublishTypingHandler } from './publish-typing.handler'

/** A DM of An and Bình (D-238); Chi may no longer write in hers with An. */
const DM_WORLD = {
    conversations: [
        { channelId: 'dm-an-binh', userIds: ['an', 'binh'] as [string, string] },
        { channelId: 'dm-an-chi', userIds: ['an', 'chi'] as [string, string] }
    ],
    silenced: ['chi']
}

const HOI_DAP = '0190a0b0-0000-7000-8000-00000000c001'
const THONG_BAO = '0190a0b0-0000-7000-8000-00000000c002'

const server: AccessServer = {
    ownerId: 'an',
    roles: [{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }],
    channels: [
        { id: HOI_DAP, type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone', taskBoardEnabled: false },
        {
            id: THONG_BAO,
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'managers',
            taskBoardEnabled: false
        }
    ]
}

function world(options: { limited?: boolean; counterDown?: boolean } = {}) {
    const told: { channelId: string; event: string; data: object }[] = []
    const publisher = {
        toChannel: (channelId: string, event: string, data: object) => told.push({ channelId, event, data })
    } as unknown as EventPublisherPort
    const channels: ChannelDirectoryPort = {
        serverIdOf: async (id: string) => (id.startsWith('dm-') ? null : 'ot'),
        channelIdsOf: async () => [],
        studyRoomOf: async () => null,
        namesOf: async () => ({ servers: new Map(), channels: new Map() })
    }
    const checker: PermissionCheckerPort = {
        access: async (_serverId, userId) => {
            const timeoutUntil = userId === 'phong' ? new Date(Date.now() + 3600_000) : null
            return { server, member: { userId, roleIds: [], timeoutUntil } }
        }
    }
    const limit: SendLimitPort = {
        hit: jest.fn(async () => {
            if (options.counterDown) throw new LimitsUnavailableError()
            return { count: 1, limited: options.limited ?? false, retryAfterSeconds: 8 }
        }),
        release: jest.fn()
    }
    const users = {
        findById: async (id: string) => ({
            id,
            username: `${id}.tran`,
            displayName: id === 'binh' ? 'Bình' : null,
            deletedAt: null,
            // Dũng asked to delete the account; a tab whose socket was not cut yet still signals.
            deletionRequestedAt: id === 'dung' ? new Date() : null
        }),
        presenceOf: async (id: string) => (id === 'chi' ? 'invisible' : 'online')
    } as unknown as UserDirectoryPort
    const dmAccess = dms(DM_WORLD)
    const handler = new PublishTypingHandler(channels, checker, limit, users, publisher, dmAccess)
    const type = (userId: string, channelId = HOI_DAP) =>
        handler.handle(new TypingSignalledEvent(userId, 'socket-1', channelId))
    return { told, type, limit }
}

describe('Someone typing (REQ-MSG-06)', () => {
    it('tells the channel who is typing', async () => {
        const { told, type, limit } = world()

        await type('binh')

        expect(told).toEqual([
            {
                channelId: HOI_DAP,
                event: 'typing.started',
                data: { channelId: HOI_DAP, user: { id: 'binh', username: 'binh.tran', displayName: 'Bình' } }
            }
        ])
        expect(limit.hit).toHaveBeenCalledWith(TYPING_PER_TAB, `socket-1:${HOI_DAP}`)
    })

    it('tells nothing from someone who may not post there: managers only, or timed out', async () => {
        const { told, type } = world()
        await type('binh', THONG_BAO)
        await type('phong')
        expect(told).toEqual([])
    })

    it('counts a signal before anything is looked up: one refused costs no more than one told', async () => {
        const { type, limit } = world({ limited: true })
        await type('phong')
        expect(limit.hit).toHaveBeenCalledTimes(1)
    })

    it('tells nothing from someone invisible: typing would show they are there', async () => {
        const { told, type } = world()
        await type('chi')
        expect(told).toEqual([])
    })

    it('tells nothing from an account waiting to be deleted: others see it as deleted (D-182)', async () => {
        const { told, type } = world()
        await type('dung')
        expect(told).toEqual([])
    })

    it('tells nothing past what one tab may say in one channel in 8 seconds', async () => {
        const { told, type } = world({ limited: true })
        await type('binh')
        expect(told).toEqual([])
    })

    it('still tells while the counter cannot be reached', async () => {
        const { told, type } = world({ counterDown: true })
        await type('binh')
        expect(told).toHaveLength(1)
    })
})

describe('Typing in a DM (D-238)', () => {
    it('tells the DM who is typing, and nothing for someone who may no longer message the other one', async () => {
        const { told, type } = world()

        await type('binh', 'dm-an-binh')
        await type('chi', 'dm-an-chi')

        expect(told.map(({ channelId }) => channelId)).toEqual(['dm-an-binh'])
    })
})
