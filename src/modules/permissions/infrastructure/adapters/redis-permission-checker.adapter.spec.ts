import { Logger } from '@nestjs/common'
import { RedisClientType } from 'redis'
import { invalidate, readVersioned, writeIfUnchanged } from '@/shared/infrastructure/cache/versioned-cache'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { AccessSourcePort } from '../../application/ports'
import { RedisPermissionChecker, serverKey } from './redis-permission-checker.adapter'

// Redis itself is in permissions.integration-spec.ts; here it fails on purpose.
jest.mock('@/shared/infrastructure/cache/versioned-cache', () => ({
    readVersioned: jest.fn(),
    writeIfUnchanged: jest.fn(),
    invalidate: jest.fn()
}))

const read = jest.mocked(readVersioned)
const write = jest.mocked(writeIfUnchanged)
const drop = jest.mocked(invalidate)

const SERVER = { ownerId: 'an', roles: [], channels: [] }
const MEMBER = { userId: 'binh', roleIds: [], timeoutUntil: null }

/** Redis is an accelerator, not a dependency (D-146). */
describe('RedisPermissionChecker when Redis fails', () => {
    let error: jest.SpyInstance
    let checker: RedisPermissionChecker
    let source: { loadServer: jest.Mock; loadMember: jest.Mock }

    beforeEach(() => {
        jest.resetAllMocks()
        error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        source = { loadServer: jest.fn().mockResolvedValue(SERVER), loadMember: jest.fn().mockResolvedValue(MEMBER) }
        const metrics = { recordCacheHit: jest.fn(), recordCacheMiss: jest.fn() } as unknown as MetricsService
        checker = new RedisPermissionChecker({} as RedisClientType, source as unknown as AccessSourcePort, metrics)
    })
    afterEach(() => error.mockRestore())

    it('answers from the database while the cache cannot be read, and writes nothing back', async () => {
        read.mockRejectedValue(new Error('redis unreachable'))

        await expect(checker.access('ot', 'binh')).resolves.toEqual({ server: SERVER, member: MEMBER })
        expect(write).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledTimes(1)
    })

    it('still answers when the cache cannot be written', async () => {
        read.mockResolvedValue([
            { value: undefined, version: '1' },
            { value: undefined, version: '1' }
        ])
        write.mockRejectedValue(new Error('redis unreachable'))

        await expect(checker.access('ot', 'binh')).resolves.toEqual({ server: SERVER, member: MEMBER })
        expect(write).toHaveBeenCalledTimes(2)
        // Logged once a minute, not once per failure.
        expect(error).toHaveBeenCalledTimes(1)
    })

    it('tries an invalidation once more before giving up, and never throws: the change is committed', async () => {
        drop.mockRejectedValueOnce(new Error('redis unreachable')).mockResolvedValueOnce(undefined)
        await expect(checker.serverChanged('ot')).resolves.toBeUndefined()
        expect(drop).toHaveBeenCalledTimes(2)
        expect(drop).toHaveBeenLastCalledWith(expect.anything(), serverKey('ot'))
        expect(error).not.toHaveBeenCalled()
    })

    it('logs an invalidation lost twice: the old entry lapses within a minute', async () => {
        drop.mockRejectedValue(new Error('redis unreachable'))
        await expect(checker.memberChanged('ot', 'binh')).resolves.toBeUndefined()
        expect(drop).toHaveBeenCalledTimes(2)
        expect(error).toHaveBeenCalledTimes(1)
    })
})
