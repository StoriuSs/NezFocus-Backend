import { ERROR_CODES } from './error-response'

describe('ERROR_CODES', () => {
    it('gives every error a code of its own', () => {
        // IDEMPOTENCY_KEY_MISMATCH and IMAGE_PROCESSING_FAILED both answered
        // 422001: a code is what a log search or a support ticket quotes, and
        // two meanings for one number is how the wrong one gets investigated.
        const owners = new Map<string, string[]>()
        for (const [key, code] of Object.entries(ERROR_CODES)) owners.set(code, [...(owners.get(code) ?? []), key])
        const shared = [...owners.entries()].filter(([, keys]) => keys.length > 1)
        expect(shared).toEqual([])
    })
})
