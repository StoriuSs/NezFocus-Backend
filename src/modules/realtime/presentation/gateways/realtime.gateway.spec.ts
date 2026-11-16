import { CommandBus } from '@nestjs/cqrs'
import { Socket } from 'socket.io'
import { HeartbeatCommand, ReportIdleCommand, ReportTypingCommand } from '@/modules/realtime/application'
import { SIGNAL_WINDOW_MS } from '@/modules/realtime/domain'
import { RealtimeGateway } from './realtime.gateway'

const CHANNEL = '019a8f3e-0000-7000-8000-000000000001'

/** A gateway with one socket let in as Bình, every command it sends kept. */
const world = () => {
    const execute = jest.fn(async () => undefined)
    const gateway = new RealtimeGateway({ execute } as unknown as CommandBus)
    const socket = {
        id: 'socket-1',
        data: { connection: { userId: 'binh', rooms: [] } }
    } as unknown as Socket
    return { gateway, socket, execute }
}

describe('RealtimeGateway signals (5.3 of the M2 review)', () => {
    beforeEach(() => {
        jest.useFakeTimers({ now: Date.parse('2026-11-16T10:00:00Z') })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('ignores the 31st signal of a socket in 10 seconds, whatever the signal, and takes them again after', async () => {
        const { gateway, socket, execute } = world()
        for (let i = 0; i < 29; i++) await gateway.heartbeat(socket)
        await gateway.typing(socket, { channel_id: CHANNEL })
        await gateway.typing(socket, { channel_id: CHANNEL })
        await gateway.heartbeat(socket)
        await gateway.idle(socket, { idle: true })
        expect(execute).toHaveBeenCalledTimes(30)
        expect(execute).toHaveBeenLastCalledWith(new ReportTypingCommand('binh', 'socket-1', CHANNEL))

        jest.advanceTimersByTime(SIGNAL_WINDOW_MS)
        await gateway.heartbeat(socket)
        expect(execute).toHaveBeenCalledTimes(31)
        expect(execute).toHaveBeenLastCalledWith(new HeartbeatCommand('binh', 'socket-1'))
    })

    it('counts each socket apart', async () => {
        const { gateway, socket, execute } = world()
        const other = { id: 'socket-2', data: { connection: { userId: 'binh', rooms: [] } } } as unknown as Socket
        for (let i = 0; i < 31; i++) await gateway.heartbeat(socket)
        await gateway.idle(other, { idle: true })
        expect(execute).toHaveBeenCalledTimes(31)
        expect(execute).toHaveBeenLastCalledWith(new ReportIdleCommand('binh', 'socket-2', true))
    })
})
