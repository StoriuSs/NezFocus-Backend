import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort } from '@/modules/realtime'
import { ChannelDirectoryPort, MemberChangedEvent } from '@/modules/servers'
import { MediaRoomsUnavailableError, VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { MediaRoomsPort } from '../../ports'
import { VoiceStateChangedEvent } from '../voice-state-changed.event'
import { RecheckMemberRoomHandler } from './recheck-member-room.handler'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const JOINED = new Date('2026-11-18T10:00:00Z')
const LATER = new Date(Date.now() + 60 * 60 * 1000)
const ALL = ['microphone', 'camera', 'screen_share', 'screen_share_audio']
// Muted by a moderator: no sound at all, the screen without its sound (L5a-a).
const MUTED = ['camera', 'screen_share']
const server = (everyone = EVERYONE_DEFAULT_PERMISSIONS) =>
    ({
        ownerId: 'owner',
        roles: [{ id: 'everyone', permissions: everyone, position: 0, isEveryone: true }],
        channels: [
            {
                id: LOUNGE,
                type: 'voice',
                isPrivate: false,
                viewRoleIds: [],
                sendMode: 'everyone',
                taskBoardEnabled: false
            }
        ]
    }) as AccessServer
const row = (over: Partial<VoiceState> = {}): VoiceState => ({
    userId: 'an',
    channelId: LOUNGE,
    participantSid: 'PA_1',
    joinedAt: JOINED,
    micOn: true,
    cameraOn: false,
    screenSharing: false,
    modMuted: false,
    ...over
})

function setup({
    current = row() as VoiceState | null,
    access = server(),
    member = true,
    timeoutUntil = null as Date | null,
    serverOfRoom = 's1'
} = {}) {
    const channels = { serverIdOf: jest.fn().mockResolvedValue(serverOfRoom) }
    const checker = {
        access: jest
            .fn()
            .mockResolvedValue(member ? { server: access, member: { userId: 'an', roleIds: [], timeoutUntil } } : null)
    }
    const media = {
        setSources: jest.fn().mockResolvedValue(undefined),
        removeParticipant: jest.fn().mockResolvedValue(undefined)
    }
    const writes: VoiceWrite[] = []
    const states = {
        find: jest.fn().mockResolvedValue(current),
        inMediaTurn: jest.fn(async (_userId: string, work: () => Promise<unknown>) => work()),
        change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const write = decide(current)
            if (write) writes.push(write)
            return write?.kind === 'remove' ? { before: current, after: null } : null
        })
    }
    const events = { publish: jest.fn() }
    const publisher = { toUser: jest.fn() }
    const handler = new RecheckMemberRoomHandler(
        channels as unknown as ChannelDirectoryPort,
        checker as unknown as PermissionCheckerPort,
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        publisher as unknown as EventPublisherPort,
        events as unknown as EventBus
    )
    return { handler, media, states, writes, events, publisher }
}

describe('A member who changes while in a room of their server (D-210, D-212)', () => {
    it.each([
        ['kick', 'kick'],
        ['ban', 'ban'],
        [null, 'server_left']
    ] as const)('who left it (%s) is put out of the room and told %s', async (removedBy, reason) => {
        const { handler, media, writes, publisher } = setup({ member: false })

        await handler.handle(new MemberChangedEvent('s1', 'an', 'left', removedBy))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(writes).toEqual([{ kind: 'remove' }])
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', { channelId: LOUNGE, reason })
    })

    it('leaving another server leaves the room alone', async () => {
        const { handler, media, publisher } = setup({ serverOfRoom: 's2' })

        await handler.handle(new MemberChangedEvent('s1', 'an', 'left', 'kick'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('timed out is put out, told timeout (D-52)', async () => {
        const { handler, media, publisher } = setup({ timeoutUntil: LATER })

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'timeout'
        })
    })

    it('without CONNECT any more is put out, told permission', async () => {
        const { handler, publisher } = setup({ access: server(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT) })

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'permission'
        })
    })

    it('without SPEAK stays, sending all but the microphone; the room hears their roles again (D-205)', async () => {
        const { handler, media, events, publisher } = setup({
            access: server(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.SPEAK)
        })

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', ALL.slice(1))
        expect(events.publish).toHaveBeenCalledWith(new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', JOINED))
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it("keeps a moderator's mute through a change of roles (D-212)", async () => {
        const { handler, media } = setup({ current: row({ modMuted: true, micOn: false }) })

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', MUTED)
    })

    it("keeps a mute set after the event read the row: the row is read again in the person's media turn", async () => {
        const { handler, states, media } = setup()
        states.find.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ modMuted: true, micOn: false }))

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', MUTED)
    })

    it('leaves alone, telling nothing, one who left the room before their turn came', async () => {
        const { handler, states, media, events, publisher } = setup({ timeoutUntil: LATER })
        states.find.mockResolvedValueOnce(row()).mockResolvedValueOnce(null)

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(media.setSources).not.toHaveBeenCalled()
        expect(events.publish).not.toHaveBeenCalled()
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('leaves alone one who moved to another room before their turn came: that room is not this one', async () => {
        const { handler, states, media, publisher } = setup({ timeoutUntil: LATER })
        states.find
            .mockResolvedValueOnce(row())
            .mockResolvedValueOnce(row({ channelId: '0190a000-0000-7000-8000-00000000000b' }))

        await handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('tells nothing to one put out of nothing: LiveKit had them no more, the row was not theirs', async () => {
        const { handler, states, media, publisher } = setup({ member: false })
        media.removeParticipant.mockResolvedValue(false)
        states.change.mockResolvedValue(null)

        await handler.handle(new MemberChangedEvent('s1', 'an', 'left', 'kick'))

        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('in no room, or joining a server, changes nothing', async () => {
        const nobody = setup({ current: null })
        await nobody.handler.handle(new MemberChangedEvent('s1', 'an', 'updated'))
        expect(nobody.media.setSources).not.toHaveBeenCalled()

        const joined = setup()
        await joined.handler.handle(new MemberChangedEvent('s1', 'an', 'joined'))
        expect(joined.media.setSources).not.toHaveBeenCalled()
        expect(joined.media.removeParticipant).not.toHaveBeenCalled()
    })

    it('is not retried when LiveKit cannot be reached: the change itself stands', async () => {
        const { handler, media, publisher } = setup({ member: false })
        media.removeParticipant.mockRejectedValue(new MediaRoomsUnavailableError())

        await expect(handler.handle(new MemberChangedEvent('s1', 'an', 'left', 'kick'))).resolves.toBeUndefined()
        expect(publisher.toUser).not.toHaveBeenCalled()
    })
})
