import { CommandBus } from '@nestjs/cqrs'
import {
    AddServerItemCommand,
    ReadChannelItemsCommand,
    ReadRemovalItemsCommand,
    RemoveMessageItemsCommand,
    SyncMessageItemsCommand
} from '../../application'
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
        await notifier.memberJoined('ot', 'binh')

        expect(bus.execute.mock.calls).toEqual([
            [new SyncMessageItemsCommand(notice)],
            [new RemoveMessageItemsCommand('hoi-dap', ['m1'])],
            [new ReadChannelItemsCommand('binh', 'hoi-dap', 'm1')],
            [new ReadRemovalItemsCommand('binh', 'ot')]
        ])
    })

    it('sends a server handed over and a moderation as one server item for the person (REQ-SRV-05, REQ-ROLE-04)', async () => {
        const bus = { execute: jest.fn().mockResolvedValue(undefined) }
        const notifier = new CommandBusNotifier(bus as unknown as CommandBus)
        const until = new Date('2026-11-18T15:30:00Z')
        const server = { serverId: 'ot', serverName: 'ÔT' }

        await notifier.ownerTransferred(server, 'an', 'binh')
        await notifier.memberModerated(server, 'dung', { action: 'timeout', reason: 'Spam', timeoutUntil: until })

        expect(bus.execute.mock.calls).toEqual([
            [
                new AddServerItemCommand(
                    {
                        type: 'owner_transferred',
                        serverId: 'ot',
                        actorId: 'an',
                        facts: { name: 'ÔT', action: null, timeoutUntil: null, reason: null }
                    },
                    'binh'
                )
            ],
            [
                new AddServerItemCommand(
                    {
                        type: 'moderation',
                        serverId: 'ot',
                        actorId: null,
                        facts: { name: 'ÔT', action: 'timeout', timeoutUntil: until, reason: 'Spam' }
                    },
                    'dung'
                )
            ]
        ])
    })

    it('lets a failure reach the caller, which logs it', async () => {
        const failure = new Error('down')
        const notifier = new CommandBusNotifier({ execute: jest.fn(async () => Promise.reject(failure)) } as never)
        await expect(notifier.channelRead('binh', 'hoi-dap', 'm1')).rejects.toBe(failure)
    })
})
