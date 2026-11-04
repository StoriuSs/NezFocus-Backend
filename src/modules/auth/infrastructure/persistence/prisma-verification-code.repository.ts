import { Injectable } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { CodeCheck, CodePurpose, VerificationCodeRepositoryPort } from '@/modules/auth/domain'

interface CountedCode {
    id: string
    codeHash: string
    attempts: number
    expiresAt: Date
}

const sameHash = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

@Injectable()
export class PrismaVerificationCodeRepository implements VerificationCodeRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async replace(userId: string, purpose: CodePurpose, codeHash: string, expiresAt: Date): Promise<void> {
        await this.prisma.verificationCode.upsert({
            where: { userId_purpose: { userId, purpose } },
            create: { userId, purpose, codeHash, expiresAt },
            update: { codeHash, expiresAt, attempts: 0, consumedAt: null, createdAt: new Date() }
        })
    }

    /**
     * The attempt is counted in the same statement that reads the code, so
     * guesses made at the same moment each use one up — a read, then a
     * separate increment, would let a burst of guesses through at attempt 1.
     */
    async consume(
        userId: string,
        purpose: CodePurpose,
        codeHash: string,
        now: Date,
        maxAttempts: number
    ): Promise<CodeCheck> {
        const [code] = await this.prisma.$queryRaw<CountedCode[]>`
            UPDATE "VerificationCode" SET "attempts" = "attempts" + 1
            WHERE "userId" = ${userId} AND "purpose" = ${purpose} AND "consumedAt" IS NULL
            RETURNING "id", "codeHash", "attempts", "expiresAt"`
        // Never sent, or already used.
        if (!code) return 'invalid'
        if (code.expiresAt <= now || code.attempts > maxAttempts) return 'expired'

        if (!sameHash(code.codeHash, codeHash)) {
            // That was the last try: say so now, not on the next attempt.
            return code.attempts >= maxAttempts ? 'expired' : 'invalid'
        }

        const used = await this.prisma.verificationCode.updateMany({
            where: { id: code.id, consumedAt: null },
            data: { consumedAt: now }
        })
        return used.count === 1 ? 'ok' : 'invalid'
    }

    async deleteStale(before: Date): Promise<number> {
        const result = await this.prisma.verificationCode.deleteMany({
            where: { OR: [{ expiresAt: { lt: before } }, { consumedAt: { lt: before } }] }
        })
        return result.count
    }
}
