import { CommandBus } from '@nestjs/cqrs'
import { PostStudySessionCommand } from '@/modules/messaging'
import { SESSIONS } from '../../study-test-world.shared-spec'
import { FocusSessionChangedEvent } from '../focus-session-changed.event'
import { PostSessionMessageHandler } from './post-session-message.handler'

const { running, paused, ended, solo } = SESSIONS

describe('PostSessionMessageHandler', () => {
    function setup() {
        const commandBus = { execute: jest.fn(async (_command: unknown) => undefined) }
        return { commandBus, handler: new PostSessionMessageHandler(commandBus as unknown as CommandBus) }
    }

    it('says who started a session and its cycle, and that it ended and why, in the room’s chat', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new FocusSessionChangedEvent(null, running, 'start', 'an', null))
        await handler.handle(new FocusSessionChangedEvent(paused, ended, 'stop', 'an', []))
        expect(commandBus.execute.mock.calls.map(([command]) => command)).toEqual([
            new PostStudySessionCommand('ot', 'phong-hoc', {
                event: 'study_session_started',
                userId: 'an',
                sessionId: 'phien',
                focusMinutes: 25,
                shortBreakMinutes: 5
            }),
            new PostStudySessionCommand('ot', 'phong-hoc', {
                event: 'study_session_ended',
                sessionId: 'phien',
                reason: 'stopped'
            })
        ])
    })

    it('says nothing for the changes between, nor for a Solo', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new FocusSessionChangedEvent(running, paused, 'pause', 'an', null))
        await handler.handle(new FocusSessionChangedEvent(null, solo, 'start', 'an', null))
        expect(commandBus.execute).not.toHaveBeenCalled()
    })

    it('throws when the message cannot be written', async () => {
        const { commandBus, handler } = setup()
        commandBus.execute.mockRejectedValueOnce(new Error('database down'))
        await expect(handler.handle(new FocusSessionChangedEvent(null, running, 'start', 'an', null))).rejects.toThrow(
            'database down'
        )
    })
})
