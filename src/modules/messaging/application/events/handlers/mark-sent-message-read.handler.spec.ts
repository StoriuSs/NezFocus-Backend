import { Logger } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ChannelNotFoundError } from '../../../domain'
import { AckChannelCommand } from '../../commands/read-state/read-state.commands'
import { MessageCreatedEvent } from '../message-created.event'
import { MessageView } from '../../services/message-views'
import { MarkSentMessageReadHandler } from './mark-sent-message-read.handler'

const sent = (author: MessageView['author']) => ({ id: 'm7', channelId: 'hoi-dap', author }) as MessageView
const binh = { id: 'binh', username: 'binh', displayName: 'Bình', avatarUrl: null }

describe('MarkSentMessageReadHandler (D-173)', () => {
    it('marks the channel read up to the message for its author, on every tab and device', async () => {
        const commands = { execute: jest.fn(async () => undefined) }

        await new MarkSentMessageReadHandler(commands as unknown as CommandBus).handle(
            new MessageCreatedEvent(sent(binh), 'n1')
        )

        expect(commands.execute).toHaveBeenCalledWith(new AckChannelCommand('binh', 'hoi-dap', 'm7'))
    })

    it('marks nothing for a system message: it has no author', async () => {
        const commands = { execute: jest.fn() }
        await new MarkSentMessageReadHandler(commands as unknown as CommandBus).handle(
            new MessageCreatedEvent(sent(null), null)
        )
        expect(commands.execute).not.toHaveBeenCalled()
    })

    it('keeps a failure to itself, logged with its stack: the message is sent either way', async () => {
        const failure = new Error('database down')
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const commands = { execute: jest.fn(async () => Promise.reject(failure)) }

        await expect(
            new MarkSentMessageReadHandler(commands as unknown as CommandBus).handle(
                new MessageCreatedEvent(sent(binh), 'n1')
            )
        ).resolves.toBeUndefined()

        expect(logged).toHaveBeenCalledWith(expect.any(String), failure)
        logged.mockRestore()
    })

    it('says nothing when the author left the server meanwhile: there is nothing to mark', async () => {
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const commands = { execute: jest.fn(async () => Promise.reject(new ChannelNotFoundError('hoi-dap'))) }

        await new MarkSentMessageReadHandler(commands as unknown as CommandBus).handle(
            new MessageCreatedEvent(sent(binh), 'n1')
        )

        expect(logged).not.toHaveBeenCalled()
        logged.mockRestore()
    })
})
