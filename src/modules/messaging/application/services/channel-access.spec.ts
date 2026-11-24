import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotMessageUserError, CannotSendError, ChannelNotFoundError, TimedOutError } from '../../domain'
import { dms, DM_STARTED } from '../dm-test-world.shared-spec'
import { ChannelUse, openChannel, requireMessaging, requireSending, timedOutUntil, viewersOf } from './channel-access'

const NOW = new Date('2026-10-18T21:47:00Z')
const LATER = new Date('2026-10-18T22:30:00Z')

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'truong-nhom', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false }
    ],
    channels: [
        {
            id: 'hoi-dap',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'thong-bao',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'managers',
            taskBoardEnabled: false
        },
        {
            id: 'ban-can-su',
            type: 'text',
            isPrivate: true,
            viewRoleIds: ['truong-nhom'],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'phong-hoc',
            type: 'voice',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
}

/** Channels of server `ot`; members `an` (owner), `binh` and `phong`, `phong` timed out until LATER. */
function world() {
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (id: string) => (server.channels.some((channel) => channel.id === id) ? 'ot' : null)),
        channelIdsOf: async () => [],

        studyRoomOf: async () => null,
        namesOf: async () => ({ servers: new Map(), channels: new Map() })
    }
    const members: Record<string, { roleIds: string[]; timeoutUntil: Date | null }> = {
        an: { roleIds: [], timeoutUntil: LATER },
        binh: { roleIds: [], timeoutUntil: null },
        phong: { roleIds: [], timeoutUntil: LATER }
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (_serverId: string, userId: string) =>
            members[userId] ? { server, member: { userId, ...members[userId] } } : null
        )
    }
    // A DM of An and Bình; Chi may no longer write in hers with An (D-238).
    const dmAccess = dms({
        conversations: [
            { channelId: 'dm-an-binh', userIds: ['an', 'binh'] },
            { channelId: 'dm-an-chi', userIds: ['an', 'chi'] }
        ],
        silenced: ['chi']
    })
    const open = (channelId: string, userId: string, use?: ChannelUse) =>
        openChannel({ channels, checker, dms: dmAccess }, channelId, userId, NOW, use)
    return { open, checker, dmAccess }
}

describe('Opening a channel to read or post (NFR-SEC-05)', () => {
    it('gives the server and what the member may do there', async () => {
        const opened = await world().open('hoi-dap', 'binh')
        expect(opened.serverId).toBe('ot')
        expect(opened.permissions & Permission.SEND_MESSAGES).toBe(Permission.SEND_MESSAGES)
    })

    it('answers not found for a channel that does not exist, asking no one', async () => {
        const { open, checker } = world()
        await expect(open('khong-co', 'binh')).rejects.toBeInstanceOf(ChannelNotFoundError)
        expect(checker.access).not.toHaveBeenCalled()
    })

    it('answers not found to someone outside the server', async () => {
        await expect(world().open('hoi-dap', 'nguoi-la')).rejects.toBeInstanceOf(ChannelNotFoundError)
    })

    it('answers not found for a private channel the member does not see', async () => {
        await expect(world().open('ban-can-su', 'binh')).rejects.toBeInstanceOf(ChannelNotFoundError)
    })

    it('opens a voice room’s chat as a text channel, saying it is a room (S-ROOM-08, D-213)', async () => {
        const opened = await world().open('phong-hoc', 'binh')
        expect(opened).toMatchObject({ serverId: 'ot', type: 'voice' })
        expect(opened.permissions & Permission.SEND_MESSAGES).toBe(Permission.SEND_MESSAGES)
        expect((await world().open('hoi-dap', 'binh')).type).toBe('text')
    })

    it('lets a timed-out member read', async () => {
        const opened = await world().open('hoi-dap', 'phong')
        expect(opened.permissions & Permission.VIEW_CHANNEL).toBe(Permission.VIEW_CHANNEL)
    })
})

describe('Who of a list views a channel (mentions, D-164)', () => {
    it('keeps those who view a voice room as those who view a text channel', async () => {
        const { checker } = world()
        expect(await viewersOf(checker, 'ot', 'phong-hoc', ['nguoi-la', 'binh', 'an'], NOW)).toEqual(['binh', 'an'])
        expect(await viewersOf(checker, 'ot', 'ban-can-su', ['binh', 'an'], NOW)).toEqual(['an'])
    })
})

describe('Posting in an open channel (REQ-ROLE-03, REQ-ROLE-04)', () => {
    it('lets a member with SEND_MESSAGES post', async () => {
        const opened = await world().open('hoi-dap', 'binh')
        expect(() => requireSending(opened, NOW)).not.toThrow()
    })

    it('refuses a channel for managers only', async () => {
        const opened = await world().open('thong-bao', 'binh')
        expect(() => requireSending(opened, NOW)).toThrow(CannotSendError)
    })

    it('refuses a timed-out member, saying until when', async () => {
        const opened = await world().open('hoi-dap', 'phong')
        let refusal: unknown
        try {
            requireSending(opened, NOW)
        } catch (error) {
            refusal = error
        }
        expect(refusal).toBeInstanceOf(TimedOutError)
        expect((refusal as TimedOutError).details).toEqual({ timeoutUntil: LATER.toISOString() })
    })

    it('says timed out rather than managers only when both hold', async () => {
        const opened = await world().open('thong-bao', 'phong')
        expect(() => requireSending(opened, NOW)).toThrow(TimedOutError)
    })

    it('lets the owner post though a timeout is on record (appendix B, step 1)', async () => {
        const opened = await world().open('thong-bao', 'an')
        expect(() => requireSending(opened, NOW)).not.toThrow()
    })

    it('refuses everyone once @everyone loses SEND_MESSAGES', async () => {
        const opened = await world().open('hoi-dap', 'binh')
        expect(() => requireSending({ ...opened, permissions: Permission.VIEW_CHANNEL }, NOW)).toThrow(CannotSendError)
    })
})

describe('Whether a timeout holds the person back (deleting one’s own message, SRS 1.70)', () => {
    it('gives until when for a timed-out member', async () => {
        const { open } = world()
        expect(timedOutUntil(await open('hoi-dap', 'phong'), NOW)).toEqual(LATER)
    })

    it('gives nothing to someone not timed out, or whose timeout ended', async () => {
        const { open } = world()
        expect(timedOutUntil(await open('hoi-dap', 'binh'), NOW)).toBeNull()
        expect(timedOutUntil(await open('hoi-dap', 'phong'), LATER)).toBeNull()
    })

    it('gives nothing to the owner though a timeout is on record (appendix B, step 1)', async () => {
        const { open } = world()
        expect(timedOutUntil(await open('hoi-dap', 'an'), NOW)).toBeNull()
    })
})

describe('Opening a DM (D-238)', () => {
    it('lets each of its two read it, with no server, no roles and no timeout', async () => {
        const { open, checker, dmAccess } = world()
        const opened = await open('dm-an-binh', 'binh')
        expect(opened).toMatchObject({ serverId: null, type: 'dm', member: null, otherId: 'an', createdAt: DM_STARTED })
        expect(opened.permissions).toBe(Permission.VIEW_CHANNEL)
        expect(timedOutUntil(opened, NOW)).toBeNull()
        expect(checker.access).not.toHaveBeenCalled()
        // Reading asks nothing about writing.
        expect(dmAccess.canMessage).not.toHaveBeenCalled()
    })

    it('answers not found to anyone else, as for a channel they may not view', async () => {
        await expect(world().open('dm-an-binh', 'phong')).rejects.toBeInstanceOf(ChannelNotFoundError)
        await expect(world().open('dm-khong-co', 'an')).rejects.toBeInstanceOf(ChannelNotFoundError)
    })

    it('lets someone who may message the other one send, attach and react, never manage', async () => {
        const opened = await world().open('dm-an-binh', 'an', 'write')
        const may = (flag: bigint) => (opened.permissions & flag) === flag
        expect(may(Permission.SEND_MESSAGES) && may(Permission.ATTACH_FILES) && may(Permission.ADD_REACTIONS)).toBe(
            true
        )
        expect(may(Permission.MANAGE_MESSAGES) || may(Permission.MENTION_EVERYONE)).toBe(false)
        expect(() => requireSending(opened, NOW)).not.toThrow()
        expect(() => requireMessaging(opened)).not.toThrow()
    })

    it('refuses someone who may no longer message the other one with the one shared answer', async () => {
        const { open } = world()
        const opened = await open('dm-an-chi', 'chi', 'write')
        expect(() => requireSending(opened, NOW)).toThrow(CannotMessageUserError)
        expect(() => requireMessaging(opened)).toThrow(CannotMessageUserError)
        // They still read it.
        await expect(open('dm-an-chi', 'chi')).resolves.toMatchObject({ type: 'dm' })
    })

    it('lets a server channel pass requireMessaging: its permissions decide', async () => {
        const opened = await world().open('thong-bao', 'binh', 'write')
        expect(() => requireMessaging(opened)).not.toThrow()
    })
})
