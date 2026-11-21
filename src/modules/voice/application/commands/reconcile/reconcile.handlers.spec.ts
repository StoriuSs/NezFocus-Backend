import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { EventPublisherPort } from '@/modules/realtime'
import { ChannelDirectoryPort } from '@/modules/servers'
import { VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { VoiceStateChangedEvent } from '../../events/voice-state-changed.event'
import { MediaRoomsPort, RoomParticipant } from '../../ports'
import { ReconcileVoiceRoomsCommand } from './reconcile.commands'
import { ReconcileVoiceRoomsHandler } from './reconcile.handlers'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const STUDY = '0190a000-0000-7000-8000-00000000000b'
const DELETED = '0190a000-0000-7000-8000-00000000000c'
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 18, 10, minutes))
const NOW = at(10)

/** Someone LiveKit lists; with no screen unless said. */
type Listed = Omit<RoomParticipant, 'sharing' | 'sessionId'> & { sharing?: boolean; sessionId?: string | null }

function setup(rows: VoiceState[], rooms: Record<string, Listed[]>, gone: string[] = [], shut: string[] = []) {
    const byUser = new Map(rows.map((row) => [row.userId, row]))
    const media = {
        listRooms: jest.fn().mockResolvedValue(Object.keys(rooms)),
        listParticipants: jest.fn(
            async (room: string): Promise<RoomParticipant[]> =>
                (rooms[room] ?? []).map((listed) => ({ sharing: false, sessionId: null, ...listed }))
        ),
        removeParticipant: jest.fn().mockResolvedValue(true)
    }
    const states = {
        connections: jest.fn(async (): Promise<VoiceState[]> => rows),
        change: jest.fn(async (userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const current = byUser.get(userId) ?? null
            const write = decide(current)
            if (!write) return null
            if (write.kind === 'remove') {
                byUser.delete(userId)
                return { before: current, after: null }
            }
            if (write.kind === 'flags') {
                if (!current) return null
                const changed = { ...current, ...write.flags }
                byUser.set(userId, changed)
                return { before: current, after: changed }
            }
            const after = { ...write.connection, micOn: false, cameraOn: false, screenSharing: false, modMuted: false }
            byUser.set(userId, after)
            return { before: current, after }
        })
    }
    const events = { publish: jest.fn() }
    const channels = { serverIdOf: jest.fn(async (channelId: string) => (gone.includes(channelId) ? null : 's1')) }
    const publisher = { toUser: jest.fn() }
    // Everyone may connect, but the people in `shut`, whose @everyone has lost CONNECT.
    const server = (permissions: bigint) =>
        ({
            ownerId: 'owner',
            roles: [{ id: 'everyone', permissions, position: 0, isEveryone: true }],
            channels: [LOUNGE, STUDY, DELETED].map((id) => ({
                id,
                type: 'voice',
                isPrivate: false,
                viewRoleIds: [],
                sendMode: 'everyone',
                taskBoardEnabled: false
            }))
        }) as AccessServer
    const checker = {
        access: jest.fn(async (_serverId: string, userId: string) => ({
            server: server(
                shut.includes(userId)
                    ? EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CONNECT
                    : EVERYONE_DEFAULT_PERMISSIONS
            ),
            member: { userId, roleIds: [], timeoutUntil: null }
        }))
    }
    const handler = new ReconcileVoiceRoomsHandler(
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        channels as unknown as ChannelDirectoryPort,
        checker as unknown as PermissionCheckerPort,
        publisher as unknown as EventPublisherPort,
        events as unknown as EventBus
    )
    return { handler, media, events, publisher, byUser }
}

const state = (userId: string, channelId: string, participantSid: string, joinedAt: Date): VoiceState => ({
    userId,
    channelId,
    participantSid,
    joinedAt,
    micOn: false,
    cameraOn: false,
    screenSharing: false,
    modMuted: false
})

describe('Reconciling voice rooms with LiveKit (D-210)', () => {
    it("reads every room with a row and every voice room LiveKit has, and sets each side's misses right", async () => {
        const { handler, media, events, byUser } = setup(
            // An's participant_left was lost; Binh is where the row says.
            [state('an', STUDY, 'PA_an', at(0)), state('binh', LOUNGE, 'PA_binh', at(1))],
            {
                [`voice:${LOUNGE}`]: [
                    { identity: 'binh', sid: 'PA_binh', joinedAt: at(1) },
                    // Chi's participant_joined was lost.
                    { identity: 'chi', sid: 'PA_chi', joinedAt: at(2), sessionId: 'session-chi' }
                ],
                'call:someone': [{ identity: 'dung', sid: 'PA_dung', joinedAt: at(2) }]
            }
        )

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toEqual({
            joined: 1,
            dropped: 1,
            evicted: 0,
            unshared: 0,
            shared: 0
        })
        expect(media.listParticipants.mock.calls.map(([room]) => room).sort()).toEqual(
            [`voice:${LOUNGE}`, `voice:${STUDY}`].sort()
        )
        expect(events.publish.mock.calls).toEqual([
            [new VoiceStateChangedEvent(STUDY, 'an', 'left', at(0), true)],
            [new VoiceStateChangedEvent(LOUNGE, 'chi', 'joined', at(2))]
        ])
        // The row it writes knows the session of the connection, which ending puts it out (D-214).
        expect(byUser.get('chi')).toMatchObject({ participantSid: 'PA_chi', sessionId: 'session-chi' })
    })

    it('empties a room whose channel is gone, telling who was in it, and drops its rows (D-212)', async () => {
        const { handler, media, events, publisher } = setup(
            // A deleted server keeps its channels a while, and Dung's row with them.
            [state('dung', DELETED, 'PA_dung', at(1))],
            {
                [`voice:${DELETED}`]: [
                    { identity: 'dung', sid: 'PA_dung', joinedAt: at(1) },
                    { identity: 'chi', sid: 'PA_chi', joinedAt: at(2) }
                ]
            },
            [DELETED]
        )

        await handler.execute(new ReconcileVoiceRoomsCommand(NOW))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${DELETED}`, 'chi')
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${DELETED}`, 'dung')
        for (const userId of ['chi', 'dung']) {
            expect(publisher.toUser).toHaveBeenCalledWith(userId, 'voice.disconnected', {
                channelId: DELETED,
                reason: 'channel_deleted'
            })
        }
        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(DELETED, 'dung', 'left', at(1))]])
    })

    it('puts out anyone in a room they may no longer be in, telling them why: a putting out LiveKit missed (D-212)', async () => {
        const { handler, media, events, publisher } = setup(
            [],
            { [`voice:${LOUNGE}`]: [{ identity: 'binh', sid: 'PA_binh', joinedAt: at(1) }] },
            [],
            ['binh']
        )

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toEqual({
            joined: 0,
            dropped: 0,
            evicted: 0,
            unshared: 0,
            shared: 0
        })
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'binh')
        expect(publisher.toUser).toHaveBeenCalledWith('binh', 'voice.disconnected', {
            channelId: LOUNGE,
            reason: 'permission'
        })
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('drops the row of one it put out as put out, not as a lost connection (D-215)', async () => {
        const { handler, events } = setup(
            [state('binh', LOUNGE, 'PA_binh', at(1))],
            { [`voice:${LOUNGE}`]: [{ identity: 'binh', sid: 'PA_binh', joinedAt: at(1) }] },
            [],
            ['binh']
        )

        await handler.execute(new ReconcileVoiceRoomsCommand(NOW))

        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'binh', 'left', at(1), false)]])
    })

    it('puts someone connected to two rooms out of the older one', async () => {
        const { handler, media } = setup([state('an', STUDY, 'PA_1', at(0))], {
            [`voice:${STUDY}`]: [{ identity: 'an', sid: 'PA_1', joinedAt: at(0) }],
            [`voice:${LOUNGE}`]: [{ identity: 'an', sid: 'PA_2', joinedAt: at(5) }]
        })

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toEqual({
            joined: 1,
            dropped: 0,
            evicted: 1,
            unshared: 0,
            shared: 0
        })
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${STUDY}`, 'an')
    })

    it('turns on the one screen sent in a room nobody is marked sharing in: a lost track_published (D-101)', async () => {
        const { handler, events } = setup([state('an', LOUNGE, 'PA_an', at(0))], {
            [`voice:${LOUNGE}`]: [{ identity: 'an', sid: 'PA_an', joinedAt: at(0), sharing: true }]
        })

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toMatchObject({ shared: 1 })
        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', at(0))]])
    })

    it('turns off a screen LiveKit no longer has for that connection: a lost track_unpublished (D-101)', async () => {
        const { handler, events } = setup(
            [
                { ...state('an', LOUNGE, 'PA_an', at(0)), screenSharing: true },
                { ...state('binh', STUDY, 'PA_binh', at(0)), screenSharing: true }
            ],
            {
                [`voice:${LOUNGE}`]: [{ identity: 'an', sid: 'PA_an', joinedAt: at(0) }],
                // Binh still shares.
                [`voice:${STUDY}`]: [{ identity: 'binh', sid: 'PA_binh', joinedAt: at(0), sharing: true }]
            }
        )

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toMatchObject({ unshared: 1 })
        expect(events.publish.mock.calls).toEqual([[new VoiceStateChangedEvent(LOUNGE, 'an', 'updated', at(0))]])
    })
})
