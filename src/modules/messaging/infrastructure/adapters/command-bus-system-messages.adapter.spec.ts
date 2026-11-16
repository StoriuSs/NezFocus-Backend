import { CommandBus } from '@nestjs/cqrs'
import { PostMemberJoinedCommand } from '../../application'
import { CommandBusSystemMessages } from './command-bus-system-messages.adapter'

describe('CommandBusSystemMessages (D-180)', () => {
    it("answers servers' memberJoined with messaging's own command, once it is done", async () => {
        let finish = () => {}
        const bus = { execute: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))) }
        let answered = false

        const joined = new CommandBusSystemMessages(bus as unknown as CommandBus)
            .memberJoined('ot', 'dung', 'chao-mung')
            .then(() => (answered = true))
        await new Promise((resolve) => setImmediate(resolve))

        expect(bus.execute).toHaveBeenCalledWith(new PostMemberJoinedCommand('ot', 'dung', 'chao-mung'))
        // The message written before servers answers the join (D-180).
        expect(answered).toBe(false)
        finish()
        await joined
        expect(answered).toBe(true)
    })

    it('lets servers hear a failure, which it logs', async () => {
        const bus = { execute: jest.fn(async () => Promise.reject(new Error('down'))) }

        await expect(
            new CommandBusSystemMessages(bus as unknown as CommandBus).memberJoined('ot', 'dung', 'chao-mung')
        ).rejects.toThrow('down')
    })
})
