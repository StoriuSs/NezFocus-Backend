import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import {
    CannotConnectError,
    MediaRoomsUnavailableError,
    VoiceRoomNotFoundError,
    VoiceState,
    VoiceStateRepositoryPort,
    VoiceTimedOutError,
    VoiceWrite
} from '../../../domain'
import { VoiceLeaveRequestedEvent } from '../../events/voice-leave-requested.event'
import { VoiceStateChangedEvent } from '../../events/voice-state-changed.event'
import { MediaRoomsPort } from '../../ports'
import { IssueJoinTokenCommand, LeaveVoiceCommand } from './connection.commands'
import { IssueJoinTokenHandler, LeaveVoiceHandler } from './connection.handlers'

const NOW = new Date()
const LATER = new Date(NOW.getTime() + 60 * 60 * 1000)
const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const STUDY = '0190a000-0000-7000-8000-00000000000b'
const voice = (id: string, isPrivate = false) => ({
    id,
    type: 'voice' as const,
    isPrivate,
    viewRoleIds: [],
    sendMode: 'everyone' as const,
    taskBoardEnabled: false
})
const server = (everyone = EVERYONE_DEFAULT_PERMISSIONS): AccessServer => ({
    ownerId: 'owner',
    roles: [{ id: 'everyone', permissions: everyone, position: 0, isEveryone: true }],
    channels: [voice(LOUNGE), voice('secret', true), { ...voice('chat'), type: 'text' }, voice(STUDY)]
})
const row = (over: Partial<VoiceState> = {}): VoiceState => ({
    userId: 'an',
    channelId: STUDY,
    participantSid: 'PA_old',
    joinedAt: NOW,
    micOn: true,
    cameraOn: false,
    screenSharing: false,
    modMuted: false,
    ...over
})

function setup({ access = server(), timeoutUntil = null as Date | null, current = null as VoiceState | null } = {}) {
    const channels = { serverIdOf: jest.fn().mockResolvedValue('s1') }
    const checker = {
        access: jest.fn().mockResolvedValue({ server: access, member: { userId: 'an', roleIds: [], timeoutUntil } })
    }
    const users = {
        findById: jest.fn().mockResolvedValue({
            id: 'an',
            displayName: 'An',
            username: 'an',
            deletedAt: null,
            deletionRequestedAt: null
        })
    }
    const media = {
        issueJoinToken: jest.fn().mockResolvedValue({ token: 'jwt', url: 'ws://localhost:7880' }),
        removeParticipant: jest.fn().mockResolvedValue(undefined)
    }
    const writes: (VoiceWrite | null)[] = []
    const states = {
        find: jest.fn().mockResolvedValue(current),
        change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const write = decide(current)
            writes.push(write)
            return write?.kind === 'remove' ? { before: current, after: null } : null
        })
    }
    const events = { publish: jest.fn() }
    const token = new IssueJoinTokenHandler(
        channels as unknown as ChannelDirectoryPort,
        checker as unknown as PermissionCheckerPort,
        users as unknown as UserDirectoryPort,
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        events as unknown as EventBus
    )
    const leave = new LeaveVoiceHandler(
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        events as unknown as EventBus
    )
    return { token, leave, channels, users, media, writes, events }
}

describe('A token to join a voice room (REQ-VC-01, D-210)', () => {
    it('is for the room, the person by id and name, sending what SPEAK and VIDEO allow', async () => {
        const { token, media } = setup()

        await expect(token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))).resolves.toEqual({
            token: 'jwt',
            url: 'ws://localhost:7880'
        })
        expect(media.issueJoinToken).toHaveBeenCalledWith({
            room: `voice:${LOUNGE}`,
            identity: 'an',
            name: 'An',
            sources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'],
            // The session asking: it ending puts the connection out (D-214).
            sessionId: 'session-an'
        })
    })

    it('gives the room no name for an account shown as deleted (D-182)', async () => {
        const { token, users, media } = setup()
        users.findById.mockResolvedValue({
            id: 'an',
            displayName: 'An',
            username: 'an',
            deletedAt: null,
            deletionRequestedAt: NOW
        })

        await token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))

        expect(media.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ name: '' }))
    })

    it('sends nothing without SPEAK or VIDEO: listening only', async () => {
        const { token, media } = setup({
            access: server(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.SPEAK & ~Permission.VIDEO)
        })

        await token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))

        expect(media.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ sources: [] }))
    })

    it('sends the microphone only without VIDEO', async () => {
        const { token, media } = setup({ access: server(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.VIDEO) })

        await token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))

        expect(media.issueJoinToken).toHaveBeenCalledWith(expect.objectContaining({ sources: ['microphone'] }))
    })

    it('is NOT_FOUND for a room one may not view, a text channel, or no channel at all (NFR-SEC-05)', async () => {
        const { token, channels, media } = setup()

        await expect(token.execute(new IssueJoinTokenCommand('an', 'secret', 'session-an'))).rejects.toBeInstanceOf(
            VoiceRoomNotFoundError
        )
        await expect(token.execute(new IssueJoinTokenCommand('an', 'chat', 'session-an'))).rejects.toBeInstanceOf(
            VoiceRoomNotFoundError
        )
        channels.serverIdOf.mockResolvedValue(null)
        await expect(token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))).rejects.toBeInstanceOf(
            VoiceRoomNotFoundError
        )
        expect(media.issueJoinToken).not.toHaveBeenCalled()
    })

    it('is FORBIDDEN without CONNECT', async () => {
        const { token, media } = setup({ access: server(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT) })

        await expect(token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))).rejects.toBeInstanceOf(
            CannotConnectError
        )
        expect(media.issueJoinToken).not.toHaveBeenCalled()
    })

    it('is MEMBER_TIMED_OUT, saying until when, for a member timed out', async () => {
        const { token } = setup({ timeoutUntil: LATER })

        const refused = token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))

        await expect(refused).rejects.toBeInstanceOf(VoiceTimedOutError)
        await expect(refused).rejects.toMatchObject({ details: { timeoutUntil: LATER.toISOString() } })
    })

    it('puts someone in another room out of it first, and tells that room (one connection per account)', async () => {
        const { token, media, writes, events } = setup({ current: row() })

        await token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${STUDY}`, 'an')
        expect(writes).toEqual([{ kind: 'remove' }])
        expect(events.publish).toHaveBeenCalledWith(new VoiceStateChangedEvent(STUDY, 'an', 'left', NOW))
        expect(media.removeParticipant.mock.invocationCallOrder[0]).toBeLessThan(
            media.issueJoinToken.mock.invocationCallOrder[0]
        )
    })

    it('leaves someone in the same room where they are: LiveKit pushes the older tab out itself', async () => {
        const { token, media } = setup({ current: row({ channelId: LOUNGE }) })

        await token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
    })

    it('gives no token while the old room cannot be left (SERVICE_UNAVAILABLE)', async () => {
        const { token, media, writes } = setup({ current: row() })
        media.removeParticipant.mockRejectedValue(new MediaRoomsUnavailableError())

        await expect(token.execute(new IssueJoinTokenCommand('an', LOUNGE, 'session-an'))).rejects.toBeInstanceOf(
            MediaRoomsUnavailableError
        )
        expect(writes).toEqual([])
        expect(media.issueJoinToken).not.toHaveBeenCalled()
    })
})

describe('Leaving a voice room (REQ-VC-02)', () => {
    it('puts them out of LiveKit and off the list at once, and tells the leaving was meant (D-228)', async () => {
        const { leave, media, writes, events } = setup({ current: row() })

        await leave.execute(new LeaveVoiceCommand('an'))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${STUDY}`, 'an')
        expect(writes).toEqual([{ kind: 'remove' }])
        expect(events.publish.mock.calls.map(([event]) => event.constructor)).toEqual([
            VoiceStateChangedEvent,
            VoiceLeaveRequestedEvent
        ])
    })

    it('changes nothing for someone in no room, yet tells the leaving was meant: LiveKit’s leave came first (D-228)', async () => {
        const { leave, media, events } = setup()

        await leave.execute(new LeaveVoiceCommand('an'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
        expect(events.publish.mock.calls).toEqual([[expect.any(VoiceLeaveRequestedEvent)]])
    })

    it('tells when the leaving was asked, so a room joined since is not left (D-228, M5 L9)', async () => {
        const { leave, events } = setup({ current: row() })
        const before = Date.now()

        await leave.execute(new LeaveVoiceCommand('an'))

        const asked = events.publish.mock.calls
            .map(([event]) => event)
            .find((e) => e instanceof VoiceLeaveRequestedEvent)
        expect(asked).toMatchObject({ userId: 'an' })
        expect(asked!.requestedAt.getTime()).toBeGreaterThanOrEqual(before)
        expect(asked!.requestedAt.getTime()).toBeLessThanOrEqual(Date.now())
    })
})
