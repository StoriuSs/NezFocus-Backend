import { LimitsUnavailableError } from '@/shared/domain'
import { RateLimitRule, RateLimitState } from '@/shared/types/rate-limit.type'
import { SendingTooFastError, UploadingTooFastError } from '../../domain'
import { SendLimitPort } from '../ports'
import { MESSAGES_PER_CHANNEL, MESSAGES_PER_PERSON, UPLOADS_PER_PERSON } from '../rate-limits'
import { countSending, countUpload } from './sending-limits'

/** Fixed-window counters in memory, one window per rule and subject, all opening at 0. */
function counters() {
    const counts = new Map<string, number>()
    const key = (rule: RateLimitRule, subject: string) => `${rule.name}:${subject}`
    const limit: SendLimitPort = {
        hit: jest.fn(async (rule: RateLimitRule, subject: string): Promise<RateLimitState> => {
            const count = (counts.get(key(rule, subject)) ?? 0) + 1
            counts.set(key(rule, subject), count)
            return { count, limited: count > rule.limit, retryAfterSeconds: rule.windowMs / 1000 }
        }),
        release: jest.fn(async (rule: RateLimitRule, subject: string) => {
            counts.set(key(rule, subject), Math.max(0, (counts.get(key(rule, subject)) ?? 0) - 1))
        })
    }
    return { limit, counts }
}

const sendTimes = async (limit: SendLimitPort, n: number, userId: string, channelId: string) => {
    for (let i = 0; i < n; i++) await countSending(limit, userId, channelId)
}

describe('Sending limits (REQ-MSG-10)', () => {
    it('are 5 in 5 seconds in a channel and 30 a minute in all', () => {
        expect([MESSAGES_PER_CHANNEL.limit, MESSAGES_PER_CHANNEL.windowMs]).toEqual([5, 5000])
        expect([MESSAGES_PER_PERSON.limit, MESSAGES_PER_PERSON.windowMs]).toEqual([30, 60_000])
    })

    it('refuse the sixth message in one channel, saying when to try again', async () => {
        const { limit } = counters()
        await sendTimes(limit, 5, 'binh', 'hoi-dap')
        const refusal = await countSending(limit, 'binh', 'hoi-dap').catch((error: unknown) => error)
        expect(refusal).toBeInstanceOf(SendingTooFastError)
        expect((refusal as SendingTooFastError).retryAfterSeconds).toBe(5)
    })

    it('count each person apart: others in the channel still send', async () => {
        const { limit } = counters()
        await sendTimes(limit, 5, 'binh', 'hoi-dap')
        await expect(countSending(limit, 'chi', 'hoi-dap')).resolves.toBeDefined()
    })

    it('count one channel apart from the next', async () => {
        const { limit } = counters()
        await sendTimes(limit, 5, 'binh', 'hoi-dap')
        await expect(countSending(limit, 'binh', 'tai-lieu')).resolves.toBeDefined()
    })

    it('refuse the 31st message in a minute across channels', async () => {
        const { limit } = counters()
        for (let channel = 0; channel < 6; channel++) await sendTimes(limit, 5, 'binh', `kenh-${channel}`)
        await expect(countSending(limit, 'binh', 'kenh-7')).rejects.toMatchObject({ retryAfterSeconds: 60 })
    })

    it('give the channel back its count when the minute refuses the message', async () => {
        const { limit, counts } = counters()
        for (let channel = 0; channel < 6; channel++) await sendTimes(limit, 5, 'binh', `kenh-${channel}`)
        await expect(countSending(limit, 'binh', 'kenh-7')).rejects.toBeInstanceOf(SendingTooFastError)
        expect(counts.get(`${MESSAGES_PER_CHANNEL.name}:binh:kenh-7`)).toBe(0)
    })

    it('hand back a way to take the message back off both counts', async () => {
        const { limit, counts } = counters()
        const counted = await countSending(limit, 'binh', 'hoi-dap')

        await counted.release()

        expect(counts.get(`${MESSAGES_PER_CHANNEL.name}:binh:hoi-dap`)).toBe(0)
        expect(counts.get(`${MESSAGES_PER_PERSON.name}:binh`)).toBe(0)
    })

    it('let messages through uncounted while the counter cannot be reached', async () => {
        const limit: SendLimitPort = {
            hit: jest.fn().mockRejectedValue(new LimitsUnavailableError()),
            release: jest.fn()
        }
        const counted = await countSending(limit, 'binh', 'hoi-dap')
        await counted.release()
        expect(limit.release).not.toHaveBeenCalled()
    })

    it('do not swallow other failures', async () => {
        const limit: SendLimitPort = { hit: jest.fn().mockRejectedValue(new Error('bug')), release: jest.fn() }
        await expect(countSending(limit, 'binh', 'hoi-dap')).rejects.toThrow('bug')
    })
})

describe('Upload limit (5.4 of the M2 review)', () => {
    it('allow 60 upload forms a minute per person, refusing the 61st with the wait', async () => {
        expect([UPLOADS_PER_PERSON.limit, UPLOADS_PER_PERSON.windowMs]).toEqual([60, 60_000])
        const { limit } = counters()
        for (let i = 0; i < 60; i++) await countUpload(limit, 'chi')
        await expect(countUpload(limit, 'chi')).rejects.toEqual(new UploadingTooFastError(60))
        await expect(countUpload(limit, 'binh')).resolves.toBeUndefined()
    })

    it('let forms through uncounted while the counter cannot be reached, and not other failures', async () => {
        const down: SendLimitPort = {
            hit: jest.fn().mockRejectedValue(new LimitsUnavailableError()),
            release: jest.fn()
        }
        await expect(countUpload(down, 'chi')).resolves.toBeUndefined()
        const broken: SendLimitPort = { hit: jest.fn().mockRejectedValue(new Error('bug')), release: jest.fn() }
        await expect(countUpload(broken, 'chi')).rejects.toThrow('bug')
    })
})
