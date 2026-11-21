import { EVERYONE_DEFAULT_PERMISSIONS } from '@/modules/permissions'
import { MembershipSnapshot, ServerRepositoryPort, ServerSnapshot } from '../../../domain'
import { IconStoragePort, RoomPeoplePort, RoomPerson, RoomSession, RoomSessionsPort } from '../../ports'
import { ListMyServersQuery } from './server.queries'
import { ListMyServersHandler } from './server.handlers'

const snapshot = (id: string, iconKey: string | null): ServerSnapshot => ({
    id,
    name: id,
    iconKey,
    ownerId: 'an',
    welcomeChannelId: null,
    categories: [],
    channels: [],
    roles: [
        {
            id: `${id}-everyone`,
            name: '@everyone',
            permissions: EVERYONE_DEFAULT_PERMISSIONS,
            position: 0,
            isEveryone: true
        }
    ]
})

describe('ListMyServersHandler', () => {
    it('keeps the join order, and gives a URL only to a server with an icon', async () => {
        const rows: MembershipSnapshot[] = [
            {
                server: snapshot('ot', 'server-icons/ot.webp'),
                member: { userId: 'an', roleIds: [], timeoutUntil: null }
            },
            { server: snapshot('nd', null), member: { userId: 'an', roleIds: [], timeoutUntil: null } }
        ]
        const servers = { listForMember: jest.fn().mockResolvedValue(rows) }
        const storage = { getReadUrl: jest.fn().mockResolvedValue('https://cdn.test/ot.webp') }
        const handler = new ListMyServersHandler(
            servers as unknown as ServerRepositoryPort,
            storage as unknown as IconStoragePort,
            { peopleOf: jest.fn().mockResolvedValue(new Map()) } as RoomPeoplePort,
            { sessionsOf: jest.fn().mockResolvedValue(new Map()) } as RoomSessionsPort
        )

        const items = await handler.execute(new ListMyServersQuery('an', 'ot'))
        expect(servers.listForMember).toHaveBeenCalledWith('an', 'ot')
        expect(items.map((item) => [item.id, item.iconUrl, item.isOwner])).toEqual([
            ['ot', 'https://cdn.test/ot.webp', true],
            ['nd', null, true]
        ])
        expect(storage.getReadUrl).toHaveBeenCalledTimes(1)
    })

    it('gives each voice room its people, read once for every server, and text channels none (D-205)', async () => {
        const channel = (id: string, type: 'text' | 'voice', isPrivate = false) => ({
            id,
            type,
            isPrivate,
            viewRoleIds: [],
            sendMode: 'everyone' as const,
            taskBoardEnabled: false,
            categoryId: null,
            name: id,
            position: 0,
            isStudyRoom: false
        })
        const server = {
            ...snapshot('ot', null),
            channels: [channel('chat', 'text'), channel('lounge', 'voice'), channel('staff-room', 'voice', true)]
        }
        const binh: RoomPerson = {
            user: { id: 'binh', username: 'binh', displayName: 'Bình', avatarUrl: null },
            roleIds: ['helper'],
            isOwner: false,
            joinedAt: new Date('2026-11-18T10:00:00Z'),
            micOn: true,
            cameraOn: false,
            screenSharing: false,
            modMuted: false
        }
        const roomPeople = { peopleOf: jest.fn().mockResolvedValue(new Map([['lounge', [binh]]])) }
        const session = { id: 'phien', phase: 'focus' } as RoomSession
        const roomSessions = { sessionsOf: jest.fn().mockResolvedValue(new Map([['lounge', session]])) }
        const handler = new ListMyServersHandler(
            {
                listForMember: jest
                    .fn()
                    .mockResolvedValue([{ server, member: { userId: 'chi', roleIds: [], timeoutUntil: null } }])
            } as unknown as ServerRepositoryPort,
            { getReadUrl: jest.fn() } as unknown as IconStoragePort,
            roomPeople,
            roomSessions
        )

        const [item] = await handler.execute(new ListMyServersQuery('chi'))

        // A private room they cannot see is not asked about, nor shown.
        expect(roomPeople.peopleOf).toHaveBeenCalledTimes(1)
        expect(roomPeople.peopleOf).toHaveBeenCalledWith(['lounge'])
        expect(roomSessions.sessionsOf).toHaveBeenCalledWith(['lounge'])
        expect(item.channels.map((shown) => [shown.id, shown.voiceStates])).toEqual([
            ['chat', null],
            ['lounge', [binh]]
        ])
        // And its study session, or null (D-220).
        expect(item.channels.map((shown) => [shown.id, shown.focusSession])).toEqual([
            ['chat', null],
            ['lounge', session]
        ])
    })
})
