import { QueryBus } from '@nestjs/cqrs'
import { ListMessagePreviewsQuery } from '../../application'
import { QueryBusMessagePreviews } from './query-bus-message-previews.adapter'

describe('QueryBusMessagePreviews (D-198)', () => {
    it('asks this module’s query and gives back its answer', async () => {
        const previews = [{ id: 'm1' }]
        const bus = { execute: jest.fn(async () => previews) }
        const asked = [{ id: 'm1', serverId: 'ot' }]

        await expect(new QueryBusMessagePreviews(bus as unknown as QueryBus).previewsOf(asked)).resolves.toBe(previews)
        expect(bus.execute).toHaveBeenCalledWith(new ListMessagePreviewsQuery(asked))
    })
})
