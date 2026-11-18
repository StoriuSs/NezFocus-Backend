import { EventBus } from '@nestjs/cqrs'
import { VoiceConnection, VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { VoiceStateChangedEvent } from '../../events/voice-state-changed.event'
import { MediaRoomsPort, RoomParticipant } from '../../ports'
import { ReconcileVoiceRoomsCommand } from './reconcile.commands'
import { ReconcileVoiceRoomsHandler } from './reconcile.handlers'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const STUDY = '0190a000-0000-7000-8000-00000000000b'
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 18, 10, minutes))
const NOW = at(10)

function setup(rows: VoiceState[], rooms: Record<string, RoomParticipant[]>) {
    const byUser = new Map(rows.map((row) => [row.userId, row]))
    const media = {
        listRooms: jest.fn().mockResolvedValue(Object.keys(rooms)),
        listParticipants: jest.fn(async (room: string) => rooms[room] ?? []),
        removeParticipant: jest.fn().mockResolvedValue(undefined)
    }
    const states = {
        connections: jest.fn(async (): Promise<VoiceConnection[]> => rows),
        change: jest.fn(async (userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const current = byUser.get(userId) ?? null
            const write = decide(current)
            if (!write) return null
            if (write.kind === 'remove') {
                byUser.delete(userId)
                return { before: current, after: null }
            }
            if (write.kind !== 'put') return null
            const after = { ...write.connection, micOn: false, cameraOn: false, screenSharing: false, modMuted: false }
            byUser.set(userId, after)
            return { before: current, after }
        })
    }
    const events = { publish: jest.fn() }
    const handler = new ReconcileVoiceRoomsHandler(
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        events as unknown as EventBus
    )
    return { handler, media, events }
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
        const { handler, media, events } = setup(
            // An's participant_left was lost; Binh is where the row says.
            [state('an', STUDY, 'PA_an', at(0)), state('binh', LOUNGE, 'PA_binh', at(1))],
            {
                [`voice:${LOUNGE}`]: [
                    { identity: 'binh', sid: 'PA_binh', joinedAt: at(1) },
                    // Chi's participant_joined was lost.
                    { identity: 'chi', sid: 'PA_chi', joinedAt: at(2) }
                ],
                'call:someone': [{ identity: 'dung', sid: 'PA_dung', joinedAt: at(2) }]
            }
        )

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toEqual({
            joined: 1,
            dropped: 1,
            evicted: 0
        })
        expect(media.listParticipants.mock.calls.map(([room]) => room).sort()).toEqual(
            [`voice:${LOUNGE}`, `voice:${STUDY}`].sort()
        )
        expect(events.publish.mock.calls).toEqual([
            [new VoiceStateChangedEvent(STUDY, 'an', 'left', at(0))],
            [new VoiceStateChangedEvent(LOUNGE, 'chi', 'joined', at(2))]
        ])
    })

    it('puts someone connected to two rooms out of the older one', async () => {
        const { handler, media } = setup([state('an', STUDY, 'PA_1', at(0))], {
            [`voice:${STUDY}`]: [{ identity: 'an', sid: 'PA_1', joinedAt: at(0) }],
            [`voice:${LOUNGE}`]: [{ identity: 'an', sid: 'PA_2', joinedAt: at(5) }]
        })

        await expect(handler.execute(new ReconcileVoiceRoomsCommand(NOW))).resolves.toEqual({
            joined: 1,
            dropped: 0,
            evicted: 1
        })
        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${STUDY}`, 'an')
    })
})
