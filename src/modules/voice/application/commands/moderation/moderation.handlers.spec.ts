import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort } from '@/modules/realtime'
import { ChannelDirectoryPort } from '@/modules/servers'
import {
    CannotModerateRoomError,
    MediaRoomsUnavailableError,
    VoiceHierarchyError,
    VoiceParticipantNotFoundError,
    VoiceRoomNotFoundError,
    VoiceState,
    VoiceStateRepositoryPort,
    VoiceTimedOutError,
    VoiceWrite
} from '../../../domain'
import { VoiceStateChangedEvent } from '../../events/voice-state-changed.event'
import { MediaRoomsPort } from '../../ports'
import { DisconnectParticipantCommand, MuteParticipantCommand, UnmuteParticipantCommand } from './moderation.commands'
import { DisconnectParticipantHandler, MuteParticipantHandler, UnmuteParticipantHandler } from './moderation.handlers'

const NOW = new Date()
const LATER = new Date(NOW.getTime() + 60 * 60 * 1000)
const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const OTHER = '0190a000-0000-7000-8000-00000000000b'
const MODERATE = Permission.MUTE_MEMBERS | Permission.MOVE_MEMBERS
const voice = (id: string, isPrivate = false) => ({
    id,
    type: 'voice' as const,
    isPrivate,
    viewRoleIds: [],
    sendMode: 'everyone' as const,
    taskBoardEnabled: false
})
const server = ({ everyone = EVERYONE_DEFAULT_PERMISSIONS, moderator = MODERATE, privateRoom = false } = {}) =>
    ({
        ownerId: 'owner',
        roles: [
            { id: 'everyone', permissions: everyone, position: 0, isEveryone: true },
            { id: 'moderator', permissions: moderator, position: 2, isEveryone: false },
            { id: 'helper', permissions: 0n, position: 1, isEveryone: false }
        ],
        channels: [voice(LOUNGE, privateRoom), voice(OTHER)]
    }) as AccessServer
const ROLES: Record<string, string[]> = { mod: ['moderator'], peer: ['moderator'], an: ['helper'], owner: [] }
const row = (over: Partial<VoiceState> = {}): VoiceState => ({
    userId: 'an',
    channelId: LOUNGE,
    participantSid: 'PA_an',
    joinedAt: NOW,
    micOn: true,
    cameraOn: true,
    screenSharing: false,
    modMuted: false,
    ...over
})

function setup({ access = server(), current = row() as VoiceState | null, actorTimeout = null as Date | null } = {}) {
    const channels = { serverIdOf: jest.fn().mockResolvedValue('s1') }
    const checker = {
        access: jest.fn(async (_serverId: string, userId: string) =>
            userId in ROLES
                ? {
                      server: access,
                      member: { userId, roleIds: ROLES[userId], timeoutUntil: userId === 'mod' ? actorTimeout : null }
                  }
                : null
        )
    }
    // What happened in and out of the person's media turn, in order.
    const steps: string[] = []
    const media = {
        setSources: jest.fn(async () => {
            steps.push('setSources')
        }),
        removeParticipant: jest.fn().mockResolvedValue(true)
    }
    const writes: VoiceWrite[] = []
    const states = {
        find: jest.fn(async (userId: string) => (current?.userId === userId ? current : null)),
        inMediaTurn: jest.fn(async (_userId: string, work: () => Promise<unknown>) => {
            steps.push('turn')
            const done = await work()
            steps.push('turn over')
            return done
        }),
        change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const write = decide(current)
            if (!write) return null
            writes.push(write)
            steps.push('change')
            if (write.kind === 'remove') return { before: current, after: null }
            if (write.kind === 'flags' && current) return { before: current, after: { ...current, ...write.flags } }
            return null
        })
    }
    const events = { publish: jest.fn() }
    const publisher = { toUser: jest.fn() }
    const deps = [
        channels as unknown as ChannelDirectoryPort,
        checker as unknown as PermissionCheckerPort,
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        publisher as unknown as EventPublisherPort,
        events as unknown as EventBus
    ] as const
    return {
        mute: new MuteParticipantHandler(...deps),
        unmute: new UnmuteParticipantHandler(...deps),
        disconnect: new DisconnectParticipantHandler(...deps),
        media,
        states,
        writes,
        events,
        publisher,
        steps
    }
}

describe('A moderator muting someone in a voice room (REQ-VC-04, D-207)', () => {
    it("takes the microphone and a screen's sound from what they may send, marks them muted and tells them (L5a-a)", async () => {
        const { mute, media, writes, events, publisher } = setup()

        await mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))

        // No sound at all: the screen still shows, without its sound.
        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', ['camera', 'screen_share'])
        expect(writes).toEqual([{ kind: 'flags', flags: { modMuted: true, micOn: false } }])
        expect(events.publish).toHaveBeenCalledWith(new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', NOW))
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.muted', { channelId: LOUNGE, muted: true })
    })

    it("sets LiveKit and the row in the person's media turn, so a recheck cannot undo it (D-212)", async () => {
        const { mute, steps } = setup()

        await mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))

        expect(steps).toEqual(['turn', 'setSources', 'change', 'turn over'])
    })

    it('mutes them on the connection they have now, a reload included', async () => {
        const { mute, writes, publisher } = setup({ current: row({ participantSid: 'PA_reload' }) })

        await mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))

        expect(writes).toEqual([{ kind: 'flags', flags: { modMuted: true, micOn: false } }])
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.muted', { channelId: LOUNGE, muted: true })
    })

    it('answers NOT_FOUND, changing nothing, when they left the room before their turn came', async () => {
        const { mute, media, states, writes } = setup()
        states.find.mockResolvedValueOnce(row()).mockResolvedValueOnce(null)

        await expect(mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))).rejects.toBeInstanceOf(
            VoiceParticipantNotFoundError
        )
        expect(media.setSources).not.toHaveBeenCalled()
        expect(writes).toEqual([])
    })

    it('does nothing to someone already muted (D-212)', async () => {
        const { mute, media, writes, publisher } = setup({ current: row({ modMuted: true, micOn: false }) })

        await mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))

        expect(media.setSources).not.toHaveBeenCalled()
        expect(writes).toEqual([])
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('needs MUTE_MEMBERS in the room: FORBIDDEN', async () => {
        const { mute, media } = setup({ access: server({ moderator: Permission.MOVE_MEMBERS }) })

        await expect(mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))).rejects.toBeInstanceOf(
            CannotModerateRoomError
        )
        expect(media.setSources).not.toHaveBeenCalled()
    })

    it('only acts on someone ranked lower: never one level, the owner, or oneself (REQ-ROLE-02)', async () => {
        for (const target of ['peer', 'owner', 'mod']) {
            const { mute, media } = setup({ current: row({ userId: target }) })
            await expect(mute.execute(new MuteParticipantCommand('mod', LOUNGE, target))).rejects.toBeInstanceOf(
                VoiceHierarchyError
            )
            expect(media.setSources).not.toHaveBeenCalled()
        }
    })

    it('answers NOT_FOUND for someone not in that room, and for a room the moderator cannot view', async () => {
        await expect(
            setup({ current: row({ channelId: OTHER }) }).mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))
        ).rejects.toBeInstanceOf(VoiceParticipantNotFoundError)
        await expect(
            setup({ current: null }).mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))
        ).rejects.toBeInstanceOf(VoiceParticipantNotFoundError)
        await expect(
            setup({ access: server({ privateRoom: true }) }).mute.execute(
                new MuteParticipantCommand('mod', LOUNGE, 'an')
            )
        ).rejects.toBeInstanceOf(VoiceRoomNotFoundError)
    })

    it('says until when to a moderator timed out (D-212)', async () => {
        const { mute } = setup({ actorTimeout: LATER })

        await expect(mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))).rejects.toEqual(
            new VoiceTimedOutError(LATER)
        )
    })

    it('writes and tells nothing when LiveKit cannot be reached', async () => {
        const { mute, media, writes, publisher } = setup()
        media.setSources.mockRejectedValue(new MediaRoomsUnavailableError())

        await expect(mute.execute(new MuteParticipantCommand('mod', LOUNGE, 'an'))).rejects.toBeInstanceOf(
            MediaRoomsUnavailableError
        )
        expect(writes).toEqual([])
        expect(publisher.toUser).not.toHaveBeenCalled()
    })
})

describe('A moderator unmuting someone (D-207)', () => {
    it('gives back what their permissions allow, unmarks them and tells them', async () => {
        const { unmute, media, writes, publisher } = setup({ current: row({ modMuted: true, micOn: false }) })

        await unmute.execute(new UnmuteParticipantCommand('mod', LOUNGE, 'an'))

        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', [
            'microphone',
            'camera',
            'screen_share',
            'screen_share_audio'
        ])
        expect(writes).toEqual([{ kind: 'flags', flags: { modMuted: false } }])
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.muted', { channelId: LOUNGE, muted: false })
    })

    it('gives no microphone to someone without SPEAK', async () => {
        const { unmute, media } = setup({
            access: server({ everyone: EVERYONE_DEFAULT_PERMISSIONS & ~Permission.SPEAK }),
            current: row({ modMuted: true, micOn: false })
        })

        await unmute.execute(new UnmuteParticipantCommand('mod', LOUNGE, 'an'))

        expect(media.setSources).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an', [
            'camera',
            'screen_share',
            'screen_share_audio'
        ])
    })

    it('does nothing to someone not muted (D-212)', async () => {
        const { unmute, media, publisher } = setup()

        await unmute.execute(new UnmuteParticipantCommand('mod', LOUNGE, 'an'))

        expect(media.setSources).not.toHaveBeenCalled()
        expect(publisher.toUser).not.toHaveBeenCalled()
    })
})

describe('A moderator putting someone out of a voice room (REQ-VC-04)', () => {
    it('ends their connection, takes them off the list and tells them why, not who', async () => {
        const { disconnect, media, writes, publisher } = setup()

        await disconnect.execute(new DisconnectParticipantCommand('mod', LOUNGE, 'an'))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(writes).toEqual([{ kind: 'remove' }])
        expect(publisher.toUser).toHaveBeenCalledWith('an', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'moderator'
        })
    })

    it('answers NOT_FOUND, telling nothing, when they left before LiveKit was asked', async () => {
        const { disconnect, media, states, publisher } = setup()
        media.removeParticipant.mockResolvedValue(false)
        states.change.mockResolvedValue(null)

        await expect(disconnect.execute(new DisconnectParticipantCommand('mod', LOUNGE, 'an'))).rejects.toBeInstanceOf(
            VoiceParticipantNotFoundError
        )
        expect(publisher.toUser).not.toHaveBeenCalled()
    })

    it('needs MOVE_MEMBERS: MUTE_MEMBERS is not enough', async () => {
        const { disconnect, media } = setup({ access: server({ moderator: Permission.MUTE_MEMBERS }) })

        await expect(disconnect.execute(new DisconnectParticipantCommand('mod', LOUNGE, 'an'))).rejects.toBeInstanceOf(
            CannotModerateRoomError
        )
        expect(media.removeParticipant).not.toHaveBeenCalled()
    })

    it('only acts on someone ranked lower', async () => {
        const { disconnect, media } = setup({ current: row({ userId: 'peer' }) })

        await expect(
            disconnect.execute(new DisconnectParticipantCommand('mod', LOUNGE, 'peer'))
        ).rejects.toBeInstanceOf(VoiceHierarchyError)
        expect(media.removeParticipant).not.toHaveBeenCalled()
    })
})
