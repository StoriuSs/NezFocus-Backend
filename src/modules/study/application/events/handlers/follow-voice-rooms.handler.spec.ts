import { CommandBus } from '@nestjs/cqrs'
import { VoiceLeaveRequestedEvent, VoiceStateChangedEvent } from '@/modules/voice'
import { JoinStudyRoomCommand, LeaveStudyRoomCommand } from '../../commands/room-presence/room-presence.commands'
import { NOW } from '../../study-test-world.shared-spec'
import { FollowVoiceRoomsHandler } from './follow-voice-rooms.handler'

describe('FollowVoiceRoomsHandler', () => {
    const setup = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
        return { commandBus, handler: new FollowVoiceRoomsHandler(commandBus as unknown as CommandBus) }
    }

    it('takes a join, a leaving and a lost connection, each as its command; a change of icons is nothing', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'joined', NOW))
        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'left', NOW))
        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'left', NOW, true))
        await handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'updated', NOW))
        expect(commandBus.execute.mock.calls).toEqual([
            [new JoinStudyRoomCommand('phong-hoc', 'an')],
            [new LeaveStudyRoomCommand('phong-hoc', 'an', false)],
            [new LeaveStudyRoomCommand('phong-hoc', 'an', true)]
        ])
    })

    it('takes one who asked to leave their room as leaving it meaning to, whichever room (D-228)', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new VoiceLeaveRequestedEvent('an'))
        expect(commandBus.execute).toHaveBeenCalledWith(new LeaveStudyRoomCommand(null, 'an', false))
    })

    it('logs a failure and goes on: the sweep sets the room right (D-225)', async () => {
        const { commandBus, handler } = setup()
        commandBus.execute.mockRejectedValueOnce(new Error('database down'))
        await expect(
            handler.handle(new VoiceStateChangedEvent('phong-hoc', 'an', 'joined', NOW))
        ).resolves.toBeUndefined()
    })
})
