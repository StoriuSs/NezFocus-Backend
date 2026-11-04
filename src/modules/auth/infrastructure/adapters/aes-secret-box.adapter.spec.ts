import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'crypto'
import { SealedWithUnknownKeyError } from '@/modules/auth/application/ports'
import { AesSecretBox } from './aes-secret-box.adapter'

const OLD = 'a'.repeat(64)
const NEW = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

/** What the box wrote before key ids: `v1.<iv>.<tag>.<ciphertext>`, and a bare HMAC. */
function beforeKeyIds(keyHex: string) {
    const derive = (info: string) =>
        Buffer.from(hkdfSync('sha256', Buffer.from(keyHex, 'hex'), Buffer.alloc(0), info, 32))
    return {
        seal(plaintext: string): string {
            const iv = randomBytes(12)
            const cipher = createCipheriv('aes-256-gcm', derive('auth:seal'), iv)
            const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
            return ['v1', ...[iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url'))].join('.')
        },
        fingerprint: (value: string) =>
            createHmac('sha256', derive('auth:fingerprint')).update(value).digest('base64url')
    }
}

describe('AesSecretBox', () => {
    const box = new AesSecretBox({ current: OLD })

    it('refuses sealed text that was altered', () => {
        const parts = box.seal('secret').split('.')
        const flipped = parts[4][0] === 'A' ? 'B' : 'A'
        expect(() => box.open([...parts.slice(0, 4), flipped + parts[4].slice(1)].join('.'))).toThrow('integrity check')
    })

    it('after a key change, opens what the previous key sealed, in either format, and hands it back sealed with the new one', () => {
        const changed = new AesSecretBox({ current: NEW, previous: OLD })
        for (const sealed of [box.seal('JBSWY3DPEHPK3PXP'), beforeKeyIds(OLD).seal('JBSWY3DPEHPK3PXP')]) {
            const { plaintext, resealed } = changed.open(sealed)
            expect(plaintext).toBe('JBSWY3DPEHPK3PXP')
            // The new key alone reads it now.
            expect(new AesSecretBox({ current: NEW }).open(resealed!).plaintext).toBe('JBSWY3DPEHPK3PXP')
        }
        // Recovery codes fingerprinted under the previous key still match.
        expect(changed.fingerprints('ABCDE-FGHJK')).toContain(box.fingerprint('ABCDE-FGHJK'))
        expect(changed.fingerprints('ABCDE-FGHJK')).toContain(beforeKeyIds(OLD).fingerprint('ABCDE-FGHJK'))
    })

    it('says so when a key it does not have sealed it, rather than failing some other way', () => {
        const changed = new AesSecretBox({ current: NEW, previous: OLD })
        expect(() => changed.open(new AesSecretBox({ current: OTHER }).seal('x'))).toThrow(SealedWithUnknownKeyError)
        expect(() => changed.open(beforeKeyIds(OTHER).seal('x'))).toThrow(SealedWithUnknownKeyError)
    })
})
