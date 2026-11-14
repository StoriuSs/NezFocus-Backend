import { EventPublisherPort } from '@/modules/realtime'
import { PinsUpdatedEvent } from '../pins-updated.event'
import { ReactionAddedEvent } from '../reaction-added.event'
import { ReactionRemovedEvent } from '../reaction-removed.event'
import { PublishPinsUpdatedHandler } from './publish-pins-updated.handler'
import { PublishReactionAddedHandler } from './publish-reaction-added.handler'
import { PublishReactionRemovedHandler } from './publish-reaction-removed.handler'

describe('Reaction and pin events to the channel (REQ-MSG-05, REQ-MSG-07, SRS 5.2)', () => {
    const publisher = () => ({ toChannel: jest.fn() })

    it('tells the channel who gave which emoji to which message', () => {
        const added = publisher()
        new PublishReactionAddedHandler(added as unknown as EventPublisherPort).handle(
            new ReactionAddedEvent('hoi-dap', 'm1', '👍', 'binh')
        )
        expect(added.toChannel).toHaveBeenCalledWith('hoi-dap', 'reaction.added', {
            channelId: 'hoi-dap',
            messageId: 'm1',
            emoji: '👍',
            userId: 'binh'
        })
    })

    it('tells the channel who took which emoji off', () => {
        const removed = publisher()
        new PublishReactionRemovedHandler(removed as unknown as EventPublisherPort).handle(
            new ReactionRemovedEvent('hoi-dap', 'm1', '👍', 'binh')
        )
        expect(removed.toChannel).toHaveBeenCalledWith('hoi-dap', 'reaction.removed', {
            channelId: 'hoi-dap',
            messageId: 'm1',
            emoji: '👍',
            userId: 'binh'
        })
    })

    it('tells the channel which message was pinned or unpinned', () => {
        const pins = publisher()
        new PublishPinsUpdatedHandler(pins as unknown as EventPublisherPort).handle(
            new PinsUpdatedEvent('hoi-dap', 'm1', false)
        )
        expect(pins.toChannel).toHaveBeenCalledWith('hoi-dap', 'pins.updated', {
            channelId: 'hoi-dap',
            messageId: 'm1',
            pinned: false
        })
    })
})
