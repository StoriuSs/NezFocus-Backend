import { LimitsUnavailableError } from '@/shared/domain'
import { InviteGuessesLimitedError, InviteInvalidError, ServerNotFoundError } from '../../domain'
import { GuessLimitPort } from '../ports'
import { countingGuesses, INVITE_GUESSES_PER_NETWORK } from './invite-guesses'

const IP = '10.1.2.3'

const limiter = (limited = false) => {
    const state = { count: limited ? 30 : 0, limited, retryAfterSeconds: 42 }
    return {
        check: jest.fn(async () => state),
        hit: jest.fn(async () => ({ ...state, count: state.count + 1 }))
    } as unknown as jest.Mocked<GuessLimitPort>
}

describe('countingGuesses', () => {
    it('refuses once the network has spent its 30 wrong codes, without running the lookup', async () => {
        const limit = limiter(true)
        const lookup = jest.fn()
        await expect(countingGuesses(limit, IP, lookup)).rejects.toEqual(new InviteGuessesLimitedError(42))
        expect(lookup).not.toHaveBeenCalled()
        expect(limit.check).toHaveBeenCalledWith(INVITE_GUESSES_PER_NETWORK, IP)
        expect(limit.hit).not.toHaveBeenCalled()
    })

    it('counts only an invalid code, after the lookup', async () => {
        const limit = limiter()
        await expect(countingGuesses(limit, IP, async () => 'ok')).resolves.toBe('ok')
        await expect(
            countingGuesses(limit, IP, async () => {
                throw new ServerNotFoundError('ot')
            })
        ).rejects.toBeInstanceOf(ServerNotFoundError)
        expect(limit.hit).not.toHaveBeenCalled()
        await expect(
            countingGuesses(limit, IP, async () => {
                throw new InviteInvalidError()
            })
        ).rejects.toBeInstanceOf(InviteInvalidError)
        expect(limit.hit).toHaveBeenCalledWith(INVITE_GUESSES_PER_NETWORK, IP)
    })

    it('lets lookups through uncounted while the counter is down', async () => {
        const limit = limiter()
        limit.check.mockRejectedValue(new LimitsUnavailableError())
        limit.hit.mockRejectedValue(new LimitsUnavailableError())
        await expect(countingGuesses(limit, IP, async () => 'ok')).resolves.toBe('ok')
        await expect(
            countingGuesses(limit, IP, async () => {
                throw new InviteInvalidError()
            })
        ).rejects.toBeInstanceOf(InviteInvalidError)
    })

    it('passes on any other failure of the counter', async () => {
        const limit = limiter()
        limit.check.mockRejectedValue(new Error('boom'))
        await expect(countingGuesses(limit, IP, async () => 'ok')).rejects.toThrow('boom')
    })
})
