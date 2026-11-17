import { CommandBus } from '@nestjs/cqrs'
import { ReadChannelItemsCommand, RemoveMessageItemsCommand, SyncMessageItemsCommand } from '../../application'
import { CommandBusNotifier } from './command-bus-notifier.adapter'

describe('CommandBusNotifier (D-185)', () => {
    it('sends each call as this module’s command, and waits for it', async () => {
        let done = false
        const bus = {
            execute: jest.fn(async () => {
                await Promise.resolve()
                done = true
            })
        }
        const notifier = new CommandBusNotifier(bus as unknown as CommandBus)
        const notice = { messageId: 'm1' } as never

        await notifier.messageMentions(notice)
        expect(done).toBe(true)
        await notifier.messagesDeleted('hoi-dap', ['m1'])
        await notifier.channelRead('binh', 'hoi-dap', 'm1')

        expect(bus.execute.mock.calls).toEqual([
            [new SyncMessageItemsCommand(notice)],
            [new RemoveMessageItemsCommand('hoi-dap', ['m1'])],
            [new ReadChannelItemsCommand('binh', 'hoi-dap', 'm1')]
        ])
    })

    it('lets a failure reach the caller, which logs it', async () => {
        const failure = new Error('down')
        const notifier = new CommandBusNotifier({ execute: jest.fn(async () => Promise.reject(failure)) } as never)
        await expect(notifier.channelRead('binh', 'hoi-dap', 'm1')).rejects.toBe(failure)
    })
})
