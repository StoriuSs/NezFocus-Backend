import { CommandBus } from '@nestjs/cqrs'
import { EndActiveCallCommand } from '../../application'
import { CommandBusActiveCalls } from './command-bus-active-calls.adapter'

describe('CommandBusActiveCalls (D-246)', () => {
    it('ends the active call of someone joining a voice room through this module’s own command', async () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }

        await new CommandBusActiveCalls(commandBus as unknown as CommandBus).endFor('an')

        expect(commandBus.execute).toHaveBeenCalledWith(new EndActiveCallCommand('an'))
    })

    it('lets its failure through: the voice token is not given', async () => {
        const commandBus = { execute: jest.fn().mockRejectedValue(new Error('database down')) }

        await expect(new CommandBusActiveCalls(commandBus as unknown as CommandBus).endFor('an')).rejects.toThrow(
            'database down'
        )
    })
})
