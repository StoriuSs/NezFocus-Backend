import { CommandBus } from '@nestjs/cqrs'
import { ServerChangedEvent } from '@/modules/servers'
import { EndGoneRoomSessionsCommand } from '../../commands/room-session/room-session.commands'
import { CheckServerRoomsHandler } from './check-server-rooms.handler'

describe('CheckServerRoomsHandler', () => {
    const setup = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
        return { commandBus, handler: new CheckServerRoomsHandler(commandBus as unknown as CommandBus) }
    }

    it('reads the rooms again when a channel changed or went, or the server did (D-227)', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'updated' }], false))
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'deleted' }], true))
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'server', action: 'deleted' }], true))
        expect(commandBus.execute.mock.calls).toEqual([
            [new EndGoneRoomSessionsCommand('ot')],
            [new EndGoneRoomSessionsCommand('ot')],
            [new EndGoneRoomSessionsCommand('ot')]
        ])
    })

    it('reads nothing for anything else: a new channel, roles, invites, the server renamed', async () => {
        const { commandBus, handler } = setup()
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'created' }], true))
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'role', action: 'updated' }], true))
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'invite', action: 'created' }], false))
        await handler.handle(new ServerChangedEvent('ot', [{ topic: 'server', action: 'updated' }], false))
        expect(commandBus.execute).not.toHaveBeenCalled()
    })

    it('logs a failure and goes on: the sweep checks every room (D-225)', async () => {
        const { commandBus, handler } = setup()
        commandBus.execute.mockRejectedValueOnce(new Error('database down'))
        await expect(
            handler.handle(new ServerChangedEvent('ot', [{ topic: 'channel', action: 'deleted' }], true))
        ).resolves.toBeUndefined()
    })
})
