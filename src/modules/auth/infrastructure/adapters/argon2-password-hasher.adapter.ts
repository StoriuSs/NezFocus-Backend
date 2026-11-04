import { Injectable, OnModuleInit } from '@nestjs/common'
import { Algorithm, hash, verify } from '@node-rs/argon2'
import { PasswordHasherPort } from '@/modules/auth/application/ports'

/**
 * argon2id with the OWASP-recommended parameters: 19 MiB of memory, two
 * passes, one lane. Deliberately slow and memory-hungry — that is the point —
 * so a sign-in costs a noticeable slice of a CPU (see docs/load-testing.md).
 *
 * `@node-rs/argon2` rather than `argon2`: it ships prebuilt binaries for
 * Alpine's musl, so the image needs no compiler and no install scripts.
 */
export const ARGON2_PARAMETERS = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
}

@Injectable()
export class Argon2PasswordHasher implements PasswordHasherPort, OnModuleInit {
    /** A real hash of nothing in particular, for accounts that do not exist. */
    private dummyHash = ''

    async onModuleInit(): Promise<void> {
        this.dummyHash = await hash('not-a-real-password', ARGON2_PARAMETERS)
    }

    hash(password: string): Promise<string> {
        return hash(password, ARGON2_PARAMETERS)
    }

    async verify(storedHash: string, password: string): Promise<boolean> {
        try {
            return await verify(storedHash, password)
        } catch {
            // A malformed stored hash is a wrong password, not a server error.
            return false
        }
    }

    async verifyDummy(password: string): Promise<void> {
        await this.verify(this.dummyHash || (await this.hash('x')), password)
    }

    needsRehash(storedHash: string): boolean {
        const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash)
        if (!match) return true
        const [memory, time, lanes] = match.slice(1).map(Number)
        return (
            memory < ARGON2_PARAMETERS.memoryCost ||
            time < ARGON2_PARAMETERS.timeCost ||
            lanes !== ARGON2_PARAMETERS.parallelism
        )
    }
}
