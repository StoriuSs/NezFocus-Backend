import { Injectable } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { CodeCheck, CodePurpose, VerificationCodeRepositoryPort } from '@/modules/auth/domain'

interface CountedCode {
    codeHash: string
    attempts: number
    expiresAt: Date
}

const sameHash = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

@Injectable()
export class PrismaVerificationCodeRepository implements VerificationCodeRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async replace(email: string, purpose: CodePurpose, codeHash: string, expiresAt: Date): Promise<void> {
        await this.prisma.verificationCode.upsert({
            where: { email_purpose: { email, purpose } },
            create: { email, purpose, codeHash, expiresAt },
            update: { codeHash, expiresAt, attempts: 0, consumedAt: null, createdAt: new Date() }
        })
    }

    /**
     * The try is counted in the same statement that reads the code, so
     * guesses made at the same moment each use one up — a read, then a
     * separate increment, would let a burst of guesses through at try 1.
     * Only a wrong guess uses one: a right code checked again — a reset that
     * refused the password and kept the code — is not worn out by its owner
     * (Kiểm 2 review). For a right guess `attempts` is then the count before
     * it, so the code was dead already if that reached the maximum.
     */
    async check(
        email: string,
        purpose: CodePurpose,
        codeHash: string,
        now: Date,
        maxAttempts: number
    ): Promise<CodeCheck> {
        const [code] = await this.prisma.$queryRaw<CountedCode[]>`
            UPDATE "VerificationCode"
            SET "attempts" = "attempts" + CASE WHEN "codeHash" = ${codeHash} THEN 0 ELSE 1 END
            WHERE "email" = ${email} AND "purpose" = ${purpose} AND "consumedAt" IS NULL
            RETURNING "codeHash", "attempts", "expiresAt"`
        // Never sent, or already used.
        if (!code) return 'wrong'
        if (sameHash(code.codeHash, codeHash)) {
            return code.expiresAt <= now || code.attempts >= maxAttempts ? 'expired' : 'right'
        }
        if (code.expiresAt <= now || code.attempts > maxAttempts) return 'expired'
        // That was the last try: say so now, not on the next one.
        return code.attempts >= maxAttempts ? 'expired' : 'wrong'
    }

    async use(email: string, purpose: CodePurpose, codeHash: string, now: Date): Promise<boolean> {
        const used = await this.prisma.verificationCode.updateMany({
            where: { email, purpose, codeHash, consumedAt: null },
            data: { consumedAt: now }
        })
        return used.count === 1
    }

    async deleteStale(before: Date): Promise<number> {
        const result = await this.prisma.verificationCode.deleteMany({
            where: { OR: [{ expiresAt: { lt: before } }, { consumedAt: { lt: before } }] }
        })
        return result.count
    }
}
