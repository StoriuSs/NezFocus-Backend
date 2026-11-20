import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MediaRoomsUnavailableError } from '../../domain'
import { PrismaVoiceStateRepository } from './prisma-voice-state.repository'

/**
 * The queue of lock holders (M4 A2b, backend-review 14.2): a turn that waits
 * too long for its place answers as a moment's unavailability (503), not a
 * plain 500. That holders do not take the whole pool is the integration
 * test's (voice-locks).
 */
describe('PrismaVoiceStateRepository lock holders', () => {
    afterEach(() => jest.useRealTimers())

    it('answers a media turn that waited too long for its place as voice unavailable for a moment', async () => {
        jest.useFakeTimers()
        // A transaction that never ends: the only place (a pool of 3 gives one) stays taken.
        const prisma = { $transaction: jest.fn(() => new Promise(() => undefined)) }
        const repository = new PrismaVoiceStateRepository(
            prisma as unknown as PrismaService,
            new ConfigService({ database: { poolMax: 3 } })
        )

        void repository.inMediaTurn('an', async () => undefined)
        const waiting = repository.tellOccupants('room', async () => undefined)
        jest.advanceTimersByTime(60_000)

        await expect(waiting).rejects.toBeInstanceOf(MediaRoomsUnavailableError)
        expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })
})
