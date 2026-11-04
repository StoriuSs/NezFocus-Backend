import { newRecoveryCodes, RECOVERY_CODE_COUNT } from './recovery-codes'

describe('recovery codes', () => {
    it('makes ten distinct codes in the XXXXX-XXXXX form, without look-alike characters', () => {
        const codes = newRecoveryCodes()
        expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
        expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT)
        for (const code of codes) expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/)
    })
})
