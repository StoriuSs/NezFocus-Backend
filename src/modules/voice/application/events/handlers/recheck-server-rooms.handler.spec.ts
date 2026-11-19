import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort } from '@/modules/realtime'
import { ChannelDirectoryPort, ServerChangedEvent } from '@/modules/servers'
import { RoomOccupant, VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { MediaRoomsPort } from '../../ports'
import { RecheckServerRoomsHandler } from './recheck-server-rooms.handler'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const GONE = '0190a000-0000-7000-8000-00000000000c'
const JOINED = new Date('2026-11-18T10:00:00Z')
const voice = {
    id: LOUNGE,
    type: 'voice',
    isPrivate: false,
    viewRoleIds: [],
    sendMode: 'everyone',
    taskBoardEnabled: false
}
const server = (roles: AccessServer['roles']) => ({ ownerId: 'owner', roles, channels: [voice] }) as AccessServer
const occupant = (userId: string): RoomOccupant => ({
    userId,
    channelId: LOUNGE,
    participantSid: `PA_${userId}`,
    joinedAt: JOINED,
    micOn: false,
    cameraOn: false,
    screenSharing: false,
    modMuted: false,
    person: { id: userId, username: userId, displayName: null, avatarKey: null }
})

function setup({
    access = 'kept' as 'kept' | 'none',
    serverOf = { [LOUNGE]: 's1' } as Record<string, string | null>
} = {}) {
    // Each sees the server through their own access: Bình's @everyone has lost CONNECT.
    const roles = {
        an: server([{ id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true }]),
        binh: server([
            {
                id: 'everyone',
                permissions: EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT,
                position: 0,
                isEveryone: true
            }
        ])
    } as Record<string, AccessServer>
    const channels = {
        serverIdOf: jest.fn(async (channelId: string) => serverOf[channelId] ?? null),
        channelIdsOf: jest.fn().mockResolvedValue([LOUNGE, 'text'])
    }
    const checker = {
        access: jest.fn(async (_serverId: string, userId: string) =>
            access === 'kept' ? { server: roles[userId], member: { userId, roleIds: [], timeoutUntil: null } } : null
        )
    }
    const media = {
        setSources: jest.fn().mockResolvedValue(undefined),
        removeParticipant: jest.fn().mockResolvedValue(true),
        listRooms: jest.fn().mockResolvedValue([`voice:${LOUNGE}`, `voice:${GONE}`, 'call:x']),
        listParticipants: jest.fn(async (room: string) =>
            room === `voice:${GONE}` ? [{ identity: 'chi', sid: 'PA_chi', joinedAt: JOINED }] : []
        )
    }
    const occupants = [occupant('an'), occupant('binh')]
    const writes: { userId: string; write: VoiceWrite }[] = []
    const states = {
        occupantsOf: jest.fn().mockResolvedValue(occupants),
        find: jest.fn(async (userId: string) => occupants.find((one) => one.userId === userId) ?? null),
        inMediaTurn: jest.fn(async (_userId: string, work: () => Promise<unknown>) => work()),
        change: jest.fn(async (userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const current = occupants.find((one) => one.userId === userId) ?? null
            const write = decide(current)
            if (write) writes.push({ userId, write })
            return write?.kind === 'remove' ? { before: current, after: null } : null
        })
    }
    const publisher = { toUser: jest.fn() }
    const handler = new RecheckServerRoomsHandler(
        channels as unknown as ChannelDirectoryPort,
        checker as unknown as PermissionCheckerPort,
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        publisher as unknown as EventPublisherPort,
        { publish: jest.fn() } as unknown as EventBus
    )
    return { handler, media, states, writes, publisher }
}

describe("A server's change to the people in its voice rooms (D-210, D-212)", () => {
    it('puts out one who lost CONNECT, told permission; the others send what they may now', async () => {
        const { handler, media, writes, publisher } = setup()

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'role', action: 'updated' }], true))

        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', [
            'microphone',
            'camera',
            'screen_share',
            'screen_share_audio'
        ])
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'binh')
        expect(writes).toEqual([{ userId: 'binh', write: { kind: 'remove' } }])
        expect(publisher.toUser).toHaveBeenCalledWith('binh', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'permission'
        })
        expect(media.listRooms).not.toHaveBeenCalled()
    })

    it('empties the rooms of deleted channels, telling who was in them channel_deleted', async () => {
        const { handler, media, publisher } = setup()

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'channel', action: 'deleted' }], true))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${GONE}`, 'chi')
        expect(publisher.toUser).toHaveBeenCalledWith('chi', 'voice.disconnected', {
            channelId: GONE,
            reason: 'channel_deleted'
        })
        expect(media.listParticipants).not.toHaveBeenCalledWith(`voice:${LOUNGE}`)
    })

    it('puts everyone out of a deleted server, told channel_deleted', async () => {
        const { handler, media, publisher } = setup({ access: 'none', serverOf: {} })

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'server', action: 'deleted' }], true))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'binh')
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'channel_deleted'
        })
    })

    it('leaves one no longer a member to the event of their leaving', async () => {
        const { handler, media, publisher } = setup({ access: 'none' })

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'role', action: 'deleted' }], true))

        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('reads nothing for a change that cannot touch a room: a link, a role renamed or moved, a channel renamed', async () => {
        const { handler, states } = setup()

        for (const topic of ['invite', 'role', 'channel', 'server'] as const) {
            await handler.handle(new ServerChangedEvent('s1', [{ topic, action: 'updated' }], false))
        }

        expect(states.occupantsOf).not.toHaveBeenCalled()
    })

    it('tells nobody of a deleted room LiveKit no longer had them in (two runs at once)', async () => {
        const { handler, media, publisher } = setup()
        media.removeParticipant.mockResolvedValue(false)

        await handler.handle(new ServerChangedEvent('s1', [{ topic: 'channel', action: 'deleted' }], true))

        expect(publisher.toUser).not.toHaveBeenCalledWith('chi', 'voice.disconnected', expect.anything())
    })
})
