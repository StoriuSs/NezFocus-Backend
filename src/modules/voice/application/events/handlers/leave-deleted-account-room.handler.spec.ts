import { EventBus } from '@nestjs/cqrs'
import { AccountDeletionRequestedEvent } from '@/modules/auth'
import { VoiceState, VoiceStateRepositoryPort, VoiceWrite } from '../../../domain'
import { MediaRoomsPort } from '../../ports'
import { LeaveDeletedAccountRoomHandler } from './leave-deleted-account-room.handler'

const LOUNGE = '0190a000-0000-7000-8000-00000000000a'
const row: VoiceState = {
    userId: 'an',
    channelId: LOUNGE,
    participantSid: 'PA_1',
    joinedAt: new Date('2026-11-18T10:00:00Z'),
    micOn: true,
    cameraOn: false,
    screenSharing: false,
    modMuted: false
}

function setup(current: VoiceState | null) {
    const media = { removeParticipant: jest.fn().mockResolvedValue(undefined) }
    const writes: VoiceWrite[] = []
    const states = {
        find: jest.fn().mockResolvedValue(current),
        change: jest.fn(async (_userId: string, decide: (state: VoiceState | null) => VoiceWrite | null) => {
            const write = decide(current)
            if (write) writes.push(write)
            return write ? { before: current, after: null } : null
        })
    }
    const handler = new LeaveDeletedAccountRoomHandler(
        media as unknown as MediaRoomsPort,
        states as unknown as VoiceStateRepositoryPort,
        { publish: jest.fn() } as unknown as EventBus
    )
    return { handler, media, writes }
}

describe('An account starting to wait for deletion while in a voice room (D-212)', () => {
    it('leaves the room at once', async () => {
        const { handler, media, writes } = setup(row)

        await handler.handle(new AccountDeletionRequestedEvent('an'))

        expect(media.removeParticipant).toHaveBeenCalledWith(`voice:${LOUNGE}`, 'an')
        expect(writes).toEqual([{ kind: 'remove' }])
    })

    it('in no room, changes nothing', async () => {
        const { handler, media } = setup(null)

        await handler.handle(new AccountDeletionRequestedEvent('an'))

        expect(media.removeParticipant).not.toHaveBeenCalled()
    })
})
