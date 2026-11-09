import { AccessMember, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { LayoutState } from './channel-layout'
import { ChannelSnapshot, ServerSnapshot } from './member-view'
import { planUpdateServer } from './server-settings'

const NOW = new Date('2026-11-09T21:47:00Z')

const channel = (id: string, extra: Partial<ChannelSnapshot> = {}): ChannelSnapshot => ({
    id,
    type: 'text',
    isPrivate: false,
    viewRoleIds: [],
    sendMode: 'everyone',
    categoryId: 'info',
    name: id,
    position: 0,
    isStudyRoom: false,
    taskBoardEnabled: false,
    ...extra
})

/** ÔT, welcoming in `chao-mung`; `bi-mat` is private to Trưởng nhóm; one room. */
const server: ServerSnapshot = {
    id: 'ot',
    name: 'Ôn thi Giải tích 2',
    iconKey: null,
    ownerId: 'an',
    welcomeChannelId: 'chao-mung',
    categories: [{ id: 'info', name: 'Thông tin', position: 0 }],
    channels: [
        channel('chao-mung'),
        channel('hoi-dap', { position: 1 }),
        channel('bi-mat', { position: 2, isPrivate: true, viewRoleIds: ['lead'] }),
        channel('phong-on', { position: 3, type: 'voice', name: 'Phòng ôn' })
    ],
    roles: [
        { id: 'everyone', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'admin', name: 'Quản lý', permissions: Permission.MANAGE_SERVER, position: 1, isEveryone: false },
        { id: 'lead', name: 'Trưởng nhóm', permissions: Permission.MANAGE_CHANNELS, position: 2, isEveryone: false }
    ]
}

const member = (userId: string, roleIds: string[] = [], timeoutUntil: Date | null = null): AccessMember => ({
    userId,
    roleIds,
    timeoutUntil
})

const as = (who: AccessMember): LayoutState => ({ server, member: who })

const AN = member('an')
/** Manages the server, but is not in Trưởng nhóm: `bi-mat` is hidden from him. */
const TUAN = member('tuan', ['admin'])
/** Manages channels, not the server. */
const BINH = member('binh', ['lead'])

const error = (run: () => unknown) => {
    try {
        run()
    } catch (caught) {
        const { name, details } = caught as { name: string; details?: { rule: string } }
        return details ? `${name}:${details.rule}` : name
    }
    return 'none'
}

describe('who may change the server overview (S-SET-01)', () => {
    it('needs MANAGE_SERVER: managing channels is not enough, and a timed-out manager is refused', () => {
        expect(error(() => planUpdateServer(as(BINH), { name: 'ÔT 2' }, NOW))).toBe('MissingPermissionError')
        const timedOut = member('tuan', ['admin'], new Date(NOW.getTime() + 60_000))
        expect(error(() => planUpdateServer(as(timedOut), { name: 'ÔT 2' }, NOW))).toBe('MissingPermissionError')
        expect(planUpdateServer(as(TUAN), { name: 'ÔT 2' }, NOW)).toHaveLength(1)
    })
})

describe('the server name (REQ-SRV-01)', () => {
    it('is stored composed and trimmed', () => {
        expect(planUpdateServer(as(AN), { name: '  Ôn thi K22 ' }, NOW)).toEqual([
            { kind: 'updateServer', changes: { name: 'Ôn thi K22' } }
        ])
    })

    it('needs 2 to 100 characters', () => {
        expect(error(() => planUpdateServer(as(AN), { name: ' Ô ' }, NOW))).toBe('LayoutRuleError:name_invalid')
        expect(error(() => planUpdateServer(as(AN), { name: 'x'.repeat(101) }, NOW))).toBe(
            'LayoutRuleError:name_invalid'
        )
        expect(planUpdateServer(as(AN), { name: 'x'.repeat(100) }, NOW)).toHaveLength(1)
    })

    it('writes nothing when nothing changed', () => {
        expect(planUpdateServer(as(AN), { name: ' Ôn thi Giải tích 2 ' }, NOW)).toEqual([])
        expect(planUpdateServer(as(AN), { welcomeChannelId: 'chao-mung' }, NOW)).toEqual([])
        expect(planUpdateServer(as(AN), {}, NOW)).toEqual([])
    })
})

describe('the welcome channel (D-83)', () => {
    it('moves to another text channel, or to none', () => {
        expect(planUpdateServer(as(AN), { welcomeChannelId: 'hoi-dap' }, NOW)).toEqual([
            { kind: 'updateServer', changes: { welcomeChannelId: 'hoi-dap' } }
        ])
        expect(planUpdateServer(as(AN), { welcomeChannelId: null }, NOW)).toEqual([
            { kind: 'updateServer', changes: { welcomeChannelId: null } }
        ])
    })

    it('may be a private channel they see (04 Q14)', () => {
        expect(planUpdateServer(as(AN), { welcomeChannelId: 'bi-mat' }, NOW)).toHaveLength(1)
    })

    it('cannot be a channel they do not see, nor one of another server: not found', () => {
        expect(error(() => planUpdateServer(as(TUAN), { welcomeChannelId: 'bi-mat' }, NOW))).toBe(
            'ChannelNotFoundError'
        )
        expect(error(() => planUpdateServer(as(AN), { welcomeChannelId: 'elsewhere' }, NOW))).toBe(
            'ChannelNotFoundError'
        )
    })

    it('cannot be a room', () => {
        expect(error(() => planUpdateServer(as(AN), { welcomeChannelId: 'phong-on' }, NOW))).toBe(
            'LayoutRuleError:not_for_type'
        )
    })
})
