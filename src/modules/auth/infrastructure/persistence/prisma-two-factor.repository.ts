import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { TwoFactorRecord, TwoFactorRepositoryPort } from '@/modules/auth/domain'

@Injectable()
export class PrismaTwoFactorRepository implements TwoFactorRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async find(userId: string): Promise<TwoFactorRecord | null> {
        const row = await this.prisma.twoFactor.findUnique({ where: { userId } })
        return row
            ? { secretSealed: row.secretSealed, confirmed: row.confirmedAt !== null, lastUsedStep: row.lastUsedStep }
            : null
    }

    async saveUnconfirmed(userId: string, secretSealed: string): Promise<boolean> {
        // Replace an unconfirmed secret; never a confirmed one. The update's
        // condition decides, so a confirmation racing this cannot be undone.
        const replaced = await this.prisma.twoFactor.updateMany({
            where: { userId, confirmedAt: null },
            data: { secretSealed, createdAt: new Date(), lastUsedStep: null }
        })
        if (replaced.count === 1) return true
        const created = await this.prisma.twoFactor.createMany({
            data: [{ userId, secretSealed }],
            skipDuplicates: true
        })
        return created.count === 1
    }

    async confirm(userId: string, now: Date): Promise<boolean> {
        const result = await this.prisma.twoFactor.updateMany({
            where: { userId, confirmedAt: null },
            data: { confirmedAt: now }
        })
        return result.count === 1
    }

    async replaceSecret(userId: string, from: string, to: string): Promise<boolean> {
        // Only if unchanged: a new setup racing this keeps its own secret.
        const result = await this.prisma.twoFactor.updateMany({
            where: { userId, secretSealed: from },
            data: { secretSealed: to }
        })
        return result.count === 1
    }

    async useStep(userId: string, step: number): Promise<boolean> {
        const result = await this.prisma.twoFactor.updateMany({
            where: { userId, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
            data: { lastUsedStep: step }
        })
        return result.count === 1
    }

    async remove(userId: string): Promise<void> {
        await this.prisma.$transaction([
            this.prisma.recoveryCode.deleteMany({ where: { userId } }),
            this.prisma.twoFactor.deleteMany({ where: { userId } })
        ])
    }

    async replaceRecoveryCodes(userId: string, fingerprints: string[]): Promise<void> {
        await this.prisma.$transaction([
            this.prisma.recoveryCode.deleteMany({ where: { userId } }),
            this.prisma.recoveryCode.createMany({ data: fingerprints.map((fingerprint) => ({ userId, fingerprint })) })
        ])
    }

    async useRecoveryCode(userId: string, fingerprints: string[], now: Date): Promise<boolean> {
        // One code is one row, stored under one of these fingerprints.
        const result = await this.prisma.recoveryCode.updateMany({
            where: { userId, fingerprint: { in: fingerprints }, usedAt: null },
            data: { usedAt: now }
        })
        return result.count > 0
    }

    countUnusedRecoveryCodes(userId: string): Promise<number> {
        return this.prisma.recoveryCode.count({ where: { userId, usedAt: null } })
    }

    async deleteForDeletedAccounts(): Promise<number> {
        const deleted = { user: { deletedAt: { not: null } } }
        const [, secrets] = await this.prisma.$transaction([
            this.prisma.recoveryCode.deleteMany({ where: deleted }),
            this.prisma.twoFactor.deleteMany({ where: deleted })
        ])
        return secrets.count
    }
}
