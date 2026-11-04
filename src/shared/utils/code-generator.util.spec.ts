import { generateVerificationCode } from './code-generator.util'

describe('generateVerificationCode', () => {
    it('uses the whole keyspace: always six digits, a leading zero included', () => {
        // Regression: the original started its range at 10^(length-1), so no
        // code began with 0 and a tenth of the keyspace was never used.
        // 2000 draws makes a false failure vanishingly unlikely (0.9^2000).
        const codes = Array.from({ length: 2000 }, () => generateVerificationCode(6))
        expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true)
        expect(codes.some((code) => code.startsWith('0'))).toBe(true)
    })
})
