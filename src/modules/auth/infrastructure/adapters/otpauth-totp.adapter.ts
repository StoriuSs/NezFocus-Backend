import { Injectable } from '@nestjs/common'
import { Secret, TOTP } from 'otpauth'
import { TotpPort } from '@/modules/auth/application/ports'

const PERIOD_SECONDS = 30
const DIGITS = 6

/**
 * TOTP through the `otpauth` library: SHA-1, six digits, 30 seconds — the
 * settings every authenticator app supports (Google Authenticator ignores
 * anything else).
 */
@Injectable()
export class OtpauthTotp implements TotpPort {
    newSecret(): string {
        // 20 bytes: 160 bits, the size RFC 4226 recommends for SHA-1.
        return new Secret({ size: 20 }).base32
    }

    uri(secret: string, account: string, issuer: string): string {
        return this.totp(secret, { account, issuer }).toString()
    }

    match(secret: string, code: string, now: Date): number | null {
        if (!/^\d{6}$/.test(code)) return null
        const delta = this.totp(secret).validate({ token: code, timestamp: now.getTime(), window: 1 })
        if (delta === null) return null
        return Math.floor(now.getTime() / 1000 / PERIOD_SECONDS) + delta
    }

    private totp(secret: string, label: { account?: string; issuer?: string } = {}): TOTP {
        return new TOTP({
            issuer: label.issuer,
            label: label.account,
            algorithm: 'SHA1',
            digits: DIGITS,
            period: PERIOD_SECONDS,
            secret: Secret.fromBase32(secret)
        })
    }
}
