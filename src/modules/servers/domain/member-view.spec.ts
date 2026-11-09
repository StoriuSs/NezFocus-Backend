import { ALL_PERMISSIONS, AccessMember, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { ChannelSnapshot, memberView, ServerSnapshot } from './member-view'

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

/** "ÔT": a public category, a staff-only one, and a mod role that sees it. */
const server: ServerSnapshot = {
    id: 'ot',
    name: 'Ôn thi Giải tích 2',
    iconKey: null,
    ownerId: 'an',
    welcomeChannelId: 'chao-mung',
    categories: [
        { id: 'staff', name: 'Ban quản trị', position: 1 },
        { id: 'info', name: 'Thông tin', position: 0 }
    ],
    channels: [
        channel('hoi-dap', { position: 1 }),
        channel('chao-mung', { position: 0 }),
        channel('thong-bao', { position: 2, sendMode: 'managers' }),
        channel('phong-mod', { categoryId: 'staff', isPrivate: true, viewRoleIds: ['mod'] })
    ],
    roles: [
        { id: 'everyone', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'helper', name: 'Điều phối', permissions: Permission.MANAGE_CHANNELS, position: 1, isEveryone: false },
        { id: 'mod', name: 'Trưởng nhóm', permissions: Permission.MANAGE_MESSAGES, position: 2, isEveryone: false },
        { id: 'admin', name: 'Quản trị', permissions: Permission.ADMINISTRATOR, position: 3, isEveryone: false }
    ]
}

const member = (userId: string, roleIds: string[] = [], timeoutUntil: Date | null = null): AccessMember => ({
    userId,
    roleIds,
    timeoutUntil
})

describe('memberView', () => {
    it('leaves out a private channel they cannot see, and the category it alone fills', () => {
        const view = memberView(server, member('phong'), NOW)
        expect(view.channels.map((c) => c.id)).toEqual(['chao-mung', 'hoi-dap', 'thong-bao'])
        expect(view.categories.map((c) => c.id)).toEqual(['info'])
    })

    it('shows that category, empty, to someone who manages channels', () => {
        const view = memberView(server, member('chi', ['helper']), NOW)
        expect(view.channels.some((c) => c.id === 'phong-mod')).toBe(false)
        expect(view.categories.map((c) => c.id)).toEqual(['info', 'staff'])
    })

    it('shows the private channel to its role; channels come by position, the client groups them', () => {
        const view = memberView(server, member('mai', ['mod']), NOW)
        expect(view.channels.map((c) => c.id)).toEqual(['chao-mung', 'phong-mod', 'hoi-dap', 'thong-bao'])
        expect(view.categories.map((c) => c.id)).toEqual(['info', 'staff'])
    })

    it('gives each channel its own bits: no posting in a managers-only channel', () => {
        const view = memberView(server, member('phong'), NOW)
        const bits = new Map(view.channels.map((c) => [c.id, c.permissions]))
        expect(bits.get('hoi-dap')! & Permission.SEND_MESSAGES).toBe(Permission.SEND_MESSAGES)
        expect(bits.get('thong-bao')! & Permission.SEND_MESSAGES).toBe(0n)
        expect(view.permissions).toBe(EVERYONE_DEFAULT_PERMISSIONS)
    })

    it('sends who may see a private channel only to those who may edit it', () => {
        const seer = memberView(server, member('mai', ['mod']), NOW)
        expect(seer.channels.every((c) => c.viewRoleIds === null)).toBe(true)
        const editor = memberView(server, member('tuan', ['admin']), NOW)
        expect(editor.channels.find((c) => c.id === 'phong-mod')!.viewRoleIds).toEqual(['mod'])
        expect(editor.channels.find((c) => c.id === 'hoi-dap')!.viewRoleIds).toEqual([])
    })

    it('lists the roles but @everyone, highest first, marking the all-powerful one, and which they hold', () => {
        const view = memberView(server, member('mai', ['mod', 'helper']), NOW)
        expect(view.roles).toEqual([
            { id: 'admin', name: 'Quản trị', position: 3, administrator: true },
            { id: 'mod', name: 'Trưởng nhóm', position: 2, administrator: false },
            { id: 'helper', name: 'Điều phối', position: 1, administrator: false }
        ])
        expect(view.roleIds.sort()).toEqual(['helper', 'mod'])
    })

    it('marks the owner, who sees and may do everything', () => {
        const view = memberView(server, member('an'), NOW)
        expect(view.isOwner).toBe(true)
        expect(view.permissions).toBe(ALL_PERMISSIONS)
        expect(view.channels).toHaveLength(4)
    })

    it('reports the highest role held, 0 with none', () => {
        expect(memberView(server, member('mai', ['helper', 'mod']), NOW).topRolePosition).toBe(2)
        expect(memberView(server, member('phong'), NOW).topRolePosition).toBe(0)
        expect(memberView(server, member('phong'), NOW).isOwner).toBe(false)
    })

    it('reports a timeout only while it lasts, and leaves only viewing', () => {
        const later = new Date(NOW.getTime() + 60_000)
        const timedOut = memberView(server, member('phong', [], later), NOW)
        expect(timedOut.timeoutUntil).toEqual(later)
        expect(timedOut.channels.every((c) => c.permissions === Permission.VIEW_CHANNEL)).toBe(true)

        const over = memberView(server, member('phong', [], new Date(NOW.getTime() - 1)), NOW)
        expect(over.timeoutUntil).toBeNull()
    })

    it('hides the welcome channel id when that channel is hidden from them', () => {
        const privateWelcome = { ...server, welcomeChannelId: 'phong-mod' }
        expect(memberView(privateWelcome, member('phong'), NOW).welcomeChannelId).toBeNull()
        expect(memberView(privateWelcome, member('mai', ['mod']), NOW).welcomeChannelId).toBe('phong-mod')
    })

    it('gives the welcome channel id to who chooses it (MANAGE_SERVER), even when the channel is hidden from them', () => {
        const manager = { id: 'manager', name: 'Quản lý', permissions: Permission.MANAGE_SERVER, position: 1 }
        const privateWelcome = {
            ...server,
            welcomeChannelId: 'phong-mod',
            roles: [...server.roles, { ...manager, isEveryone: false }]
        }
        const view = memberView(privateWelcome, member('tuan', ['manager']), NOW)
        expect(view.channels.map((c) => c.id)).not.toContain('phong-mod')
        expect(view.welcomeChannelId).toBe('phong-mod')
    })
})
