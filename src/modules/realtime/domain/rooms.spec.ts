import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { serverRooms } from './rooms'

const NOW = new Date('2026-11-13T10:00:00Z')
const LATER = new Date('2026-11-13T11:00:00Z')

const server = (everyone = EVERYONE_DEFAULT_PERMISSIONS): AccessServer => ({
    ownerId: 'owner',
    roles: [
        { id: 'everyone', permissions: everyone, position: 0, isEveryone: true },
        { id: 'mod', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false }
    ],
    channels: [
        { id: 'general', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'staff', type: 'text', isPrivate: true, viewRoleIds: ['mod'], sendMode: 'everyone' },
        { id: 'news', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'managers' },
        { id: 'lounge', type: 'voice', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' }
    ]
})
const member = (roleIds: string[] = [], timeoutUntil: Date | null = null) => ({ userId: 'an', roleIds, timeoutUntil })

describe("A socket's rooms in one server (SRS 5.2, D-163)", () => {
    it('are the server and every text channel the member may view, a read-only one included', () => {
        expect(serverRooms('s1', server(), member(), NOW)).toEqual(['server:s1', 'channel:general', 'channel:news'])
    })

    it('leave out a private channel of a role the member lacks, and voice rooms', () => {
        const rooms = serverRooms('s1', server(), member(), NOW)
        expect(rooms).not.toContain('channel:staff')
        expect(rooms).not.toContain('channel:lounge')
    })

    it('take in that private channel once the member holds its role, and every one for the owner', () => {
        expect(serverRooms('s1', server(), member(['mod']), NOW)).toContain('channel:staff')
        expect(serverRooms('s1', server(), { ...member(), userId: 'owner' }, NOW)).toContain('channel:staff')
    })

    it('keep the channels of a timed-out member: viewing is what is left (REQ-MOD)', () => {
        expect(serverRooms('s1', server(), member([], LATER), NOW)).toEqual([
            'server:s1',
            'channel:general',
            'channel:news'
        ])
    })

    it('are the server alone when @everyone may view no channel', () => {
        const blind = server(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.VIEW_CHANNEL)
        expect(serverRooms('s1', blind, member(), NOW)).toEqual(['server:s1'])
    })
})
