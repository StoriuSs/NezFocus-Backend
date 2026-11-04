import { Inject, Injectable } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'crypto'
import { SealedWithUnknownKeyError, SecretBoxPort } from '@/modules/auth/application/ports'

/** AUTH_ENCRYPTION_KEY, and AUTH_ENCRYPTION_KEY_PREVIOUS when a key change is under way. */
export interface EncryptionKeys {
    current: string
    previous?: string
}

export const ENCRYPTION_KEYS = Symbol('AuthEncryptionKeys')

interface Key {
    /** Names the key in what it sealed; derived from it, so it reveals nothing. */
    id: string
    seal: Buffer
    fingerprint: Buffer
}

function deriveKey(hex: string, name: string): Key {
    const master = Buffer.from(hex, 'hex')
    if (master.length < 32) throw new Error(`${name} must be at least 32 bytes of hex (openssl rand -hex 32)`)
    const derive = (info: string, length: number) =>
        Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, length))
    return {
        id: derive('auth:key-id', 6).toString('base64url'),
        seal: derive('auth:seal', 32),
        fingerprint: derive('auth:fingerprint', 32)
    }
}

const decode = (part: string) => Buffer.from(part, 'base64url')

/**
 * AES-256-GCM for sealing, HMAC-SHA256 for fingerprints, each with its own key
 * derived from AUTH_ENCRYPTION_KEY (HKDF), so neither use weakens the other.
 *
 * Both name the key that made them: sealed text is
 * `v2.<key id>.<iv>.<tag>.<ciphertext>`, a fingerprint `<key id>.<hmac>`. So
 * after a key change the right key is picked rather than guessed, a secret the
 * server has no key for is told apart from a damaged one, and
 * `pnpm auth:rotate-key` can count what still needs the previous key.
 *
 * `v1.<iv>.<tag>.<ciphertext>` and a bare `<hmac>` are the formats before
 * key ids, read by trying each key.
 */
@Injectable()
export class AesSecretBox implements SecretBoxPort {
    private readonly current: Key
    private readonly keys: Key[]

    constructor(@Inject(ENCRYPTION_KEYS) keys: EncryptionKeys) {
        this.current = deriveKey(keys.current, 'AUTH_ENCRYPTION_KEY')
        this.keys = keys.previous
            ? [this.current, deriveKey(keys.previous, 'AUTH_ENCRYPTION_KEY_PREVIOUS')]
            : [this.current]
    }

    seal(plaintext: string): string {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.current.seal, iv)
        const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
        return [
            'v2',
            this.current.id,
            ...[iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64url'))
        ].join('.')
    }

    open(sealed: string): { plaintext: string; resealed: string | null } {
        const parts = sealed.split('.')
        let candidates: Key[]
        let body: string[]
        if (parts[0] === 'v2' && parts.length === 5) {
            const key = this.keys.find((k) => k.id === parts[1])
            if (!key) throw new SealedWithUnknownKeyError()
            candidates = [key]
            body = parts.slice(2)
        } else if (parts[0] === 'v1' && parts.length === 4) {
            candidates = this.keys
            body = parts.slice(1)
        } else {
            throw new Error('Not a sealed secret')
        }

        const [iv, tag, ciphertext] = body
        for (const key of candidates) {
            const plaintext = this.decrypt(key, iv, tag, ciphertext)
            if (plaintext === null) continue
            const upToDate = key === this.current && parts[0] === 'v2'
            return { plaintext, resealed: upToDate ? null : this.seal(plaintext) }
        }
        // v2 names its key, so a failure there is damage, not a missing key.
        if (parts[0] === 'v2') throw new Error('A sealed secret failed its integrity check')
        throw new SealedWithUnknownKeyError()
    }

    fingerprint(value: string): string {
        return `${this.current.id}.${this.hmac(this.current, value)}`
    }

    fingerprints(value: string): string[] {
        return this.keys.flatMap((key) => {
            const hmac = this.hmac(key, value)
            return [`${key.id}.${hmac}`, hmac]
        })
    }

    keyOf(sealedOrFingerprint: string): 'current' | 'previous' | null {
        const parts = sealedOrFingerprint.split('.')
        const id = parts[0] === 'v2' ? parts[1] : parts.length === 2 ? parts[0] : undefined
        const index = this.keys.findIndex((key) => key.id === id)
        return index === 0 ? 'current' : index === 1 ? 'previous' : null
    }

    private decrypt(key: Key, iv: string, tag: string, ciphertext: string): string | null {
        try {
            const decipher = createDecipheriv('aes-256-gcm', key.seal, decode(iv))
            decipher.setAuthTag(decode(tag))
            return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString('utf8')
        } catch {
            return null
        }
    }

    private hmac(key: Key, value: string): string {
        return createHmac('sha256', key.fingerprint).update(value).digest('base64url')
    }
}
