import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, PermissionCheckerPort } from '@/modules/permissions'
import { MembershipPort } from '@/modules/servers'
import { ReadScope, ReadStateRepositoryPort, readFloor } from '../../../domain'
import { DM_STARTED, DmWorld, dms } from '../../dm-test-world.shared-spec'
import { ListReadStatesQuery } from './read-state.queries'
import { ListReadStatesHandler } from './read-state.handlers'

const textChannel = (id: string, viewRoleIds: string[] = []) => ({
    id,
    type: 'text' as const,
    isPrivate: viewRoleIds.length > 0,
    viewRoleIds,
    sendMode: 'everyone' as const,
    taskBoardEnabled: false
})

/** ÔT: two public channels, one private to moderators, a voice room. NĐ: one channel. */
const servers: Record<string, AccessServer> = {
    ot: {
        ownerId: 'an',
        roles: [
            { id: 'ot-everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
            { id: 'quan-ly', permissions: 0n, position: 1, isEveryone: false }
        ],
        channels: [
            textChannel('hoi-dap'),
            textChannel('ban-quan-ly', ['quan-ly']),
            {
                id: 'phong-hoc',
                type: 'voice',
                isPrivate: false,
                viewRoleIds: [],
                sendMode: 'everyone',
                taskBoardEnabled: false
            },
            textChannel('tai-lieu')
        ]
    },
    nd: {
        ownerId: 'an',
        roles: [
            { id: 'nd-everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
            { id: 'mobile', permissions: 0n, position: 1, isEveryone: false }
        ],
        channels: [textChannel('chung')]
    }
}

const JOINED_OT = new Date('2026-11-01T08:00:00Z')
const JOINED_ND = new Date('2026-11-10T19:30:00Z')

/** Bình is in ÔT and NĐ (a role there), and was in a third server, gone by the time it is checked. */
function world(dmWorld: DmWorld = {}) {
    const asked: { roleIds: string[]; channels: ReadScope[] }[] = []
    const readStates = {
        states: jest.fn(async (_userId: string, roleIds: string[], channels: ReadScope[]) => {
            asked.push({ roleIds, channels })
            return channels.map(({ channelId, floorId }) => ({
                channelId,
                lastReadId: floorId,
                unreadCount: 1,
                mentionCount: 0
            }))
        })
    } as unknown as ReadStateRepositoryPort
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (serverId: string, userId: string) =>
            servers[serverId]
                ? {
                      server: servers[serverId],
                      member: { userId, roleIds: serverId === 'nd' ? ['mobile'] : [], timeoutUntil: null }
                  }
                : null
        )
    }
    const membership: MembershipPort = {
        membersAmong: jest.fn(),
        channelMembers: jest.fn(),
        sharedServers: jest.fn(),
        sharingAServer: jest.fn(),
        serverIdsOf: jest.fn(),
        membershipsOf: jest.fn(async () => [
            { serverId: 'ot', joinedAt: JOINED_OT },
            { serverId: 'left', joinedAt: JOINED_OT },
            { serverId: 'nd', joinedAt: JOINED_ND }
        ])
    }
    const dmAccess = dms(dmWorld)
    const handler = new ListReadStatesHandler(readStates, checker, membership, dmAccess)
    return { list: () => handler.execute(new ListReadStatesQuery('binh')), asked }
}

describe('ListReadStatesHandler (REQ-MSG-09, SRS 5.1)', () => {
    it('answers for every channel the person may view in each of their servers, a voice room’s chat too, with its server', async () => {
        const { list } = world()

        const states = await list()

        expect(states.map(({ serverId, channelId }) => `${serverId}/${channelId}`)).toEqual([
            'ot/hoi-dap',
            'ot/phong-hoc',
            'ot/tai-lieu',
            'nd/chung'
        ])
        expect(states[0]).toEqual({
            serverId: 'ot',
            channelId: 'hoi-dap',
            lastReadId: readFloor(JOINED_OT),
            unreadCount: 1,
            mentionCount: 0
        })
    })

    it('reads every channel in one go, each from when the person joined its server, with every role they hold', async () => {
        const { list, asked } = world()

        await list()

        // Role ids are unique across servers, and a message only mentions roles of its own server.
        expect(asked).toEqual([
            {
                roleIds: ['mobile'],
                channels: [
                    { channelId: 'hoi-dap', floorId: readFloor(JOINED_OT) },
                    { channelId: 'phong-hoc', floorId: readFloor(JOINED_OT) },
                    { channelId: 'tai-lieu', floorId: readFloor(JOINED_OT) },
                    { channelId: 'chung', floorId: readFloor(JOINED_ND) }
                ]
            }
        ])
    })

    it('adds each DM shown in their list, with no server, read from when it began (D-244)', async () => {
        const { list, asked } = world({
            conversations: [
                { channelId: 'dm-an-binh', userIds: ['an', 'binh'] },
                { channelId: 'dm-binh-chi', userIds: ['binh', 'chi'] }
            ],
            // Closed by Bình, nothing said since: not shown, so not counted.
            shown: { binh: ['dm-an-binh'] }
        })

        const states = await list()

        expect(states.at(-1)).toMatchObject({ serverId: null, channelId: 'dm-an-binh' })
        expect(states.map((state) => state.channelId)).not.toContain('dm-binh-chi')
        expect(asked[0]!.channels.at(-1)).toEqual({ channelId: 'dm-an-binh', floorId: readFloor(DM_STARTED) })
    })
})
