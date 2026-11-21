import { CommandBus } from '@nestjs/cqrs'
import { AccountDeletionRequestedEvent, SignedOutEvent } from '@/modules/auth'
import { EndSignedOutSoloCommand } from '../../commands/solo-session/solo-session.commands'
import { EndSoloOnSignOutHandler } from './end-solo-on-sign-out.handler'

describe('EndSoloOnSignOutHandler', () => {
    const setup = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
        return { commandBus, handler: new EndSoloOnSignOutHandler(commandBus as unknown as CommandBus) }
    }

    it('ends the Solo of one who signed out, and of an account that starts to wait for deletion (D-229)', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new SignedOutEvent('an'))
        await handler.handle(new AccountDeletionRequestedEvent('binh'))
        expect(commandBus.execute.mock.calls).toEqual([
            [new EndSignedOutSoloCommand('an')],
            [new EndSignedOutSoloCommand('binh')]
        ])
    })

    it('logs a failure and goes on: the Solo ends by itself, or its person stops it', async () => {
        const { commandBus, handler } = setup()
        commandBus.execute.mockRejectedValueOnce(new Error('database down'))
        await expect(handler.handle(new SignedOutEvent('an'))).resolves.toBeUndefined()
    })
})
