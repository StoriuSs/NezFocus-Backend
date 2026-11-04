import { Secret, TOTP } from 'otpauth'
import { OtpauthTotp } from './otpauth-totp.adapter'

describe('OtpauthTotp', () => {
    it("accepts the app's code one step either side of now, and refuses one two steps away or a wrong one", () => {
        const totp = new OtpauthTotp()
        const secret = totp.newSecret()
        const now = new Date('2026-09-26T10:00:15Z')
        const step = Math.floor(now.getTime() / 30_000)
        /** What an authenticator app would show at a moment. */
        const appCode = (offsetMs: number) =>
            new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
                timestamp: now.getTime() + offsetMs
            })

        expect(totp.match(secret, appCode(0), now)).toBe(step)
        expect(totp.match(secret, appCode(-30_000), now)).toBe(step - 1)
        expect(totp.match(secret, appCode(30_000), now)).toBe(step + 1)
        expect(totp.match(secret, appCode(-90_000), now)).toBeNull()
        expect(totp.match(secret, String((Number(appCode(0)) + 1) % 1_000_000).padStart(6, '0'), now)).toBeNull()
    })
})
