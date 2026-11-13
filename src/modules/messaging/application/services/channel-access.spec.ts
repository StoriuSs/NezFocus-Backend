import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { CannotSendError, ChannelNotFoundError, TimedOutError } from '../../domain'
import { openChannel, requireSending, timedOutUntil } from './channel-access'

const NOW = new Date('2026-10-18T21:47:00Z')
const LATER = new Date('2026-10-18T22:30:00Z')

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'truong-nhom', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false }
    ],
    channels: [
        { id: 'hoi-dap', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'thong-bao', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'managers' },
        { id: 'ban-can-su', type: 'text', isPrivate: true, viewRoleIds: ['truong-nhom'], sendMode: 'everyone' },
        { id: 'phong-hoc', type: 'voice', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' }
    ]
}

/** Channels of server `ot`; members `an` (owner), `binh` and `phong`, `phong` timed out until LATER. */
function world() {
    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (id: string) => (server.channels.some((channel) => channel.id === id) ? 'ot' : null))
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
    const open = (channelId: string, userId: string) => openChannel(channels, checker, channelId, userId, NOW)
    return { open, checker }
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

    it('answers not found for a voice room, which has no chat yet', async () => {
        await expect(world().open('phong-hoc', 'binh')).rejects.toBeInstanceOf(ChannelNotFoundError)
    })

    it('lets a timed-out member read', async () => {
        const opened = await world().open('hoi-dap', 'phong')
        expect(opened.permissions & Permission.VIEW_CHANNEL).toBe(Permission.VIEW_CHANNEL)
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
