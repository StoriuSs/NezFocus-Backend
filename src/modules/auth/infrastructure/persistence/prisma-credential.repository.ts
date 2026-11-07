import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { CredentialRepositoryPort } from '@/modules/auth/domain'

@Injectable()
export class PrismaCredentialRepository implements CredentialRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async findHash(userId: string): Promise<string | null> {
        const credential = await this.prisma.credential.findUnique({ where: { userId } })
        return credential?.passwordHash ?? null
    }

    async setHash(userId: string, hash: string): Promise<void> {
        await this.prisma.credential.upsert({
            where: { userId },
            create: { userId, passwordHash: hash },
            update: { passwordHash: hash, passwordUpdatedAt: new Date() }
        })
    }

    async replaceHash(userId: string, expected: string, hash: string): Promise<boolean> {
        const replaced = await this.prisma.credential.updateMany({
            where: { userId, passwordHash: expected },
            data: { passwordHash: hash, passwordUpdatedAt: new Date() }
        })
        return replaced.count === 1
    }

    async delete(userId: string): Promise<void> {
        await this.prisma.credential.deleteMany({ where: { userId } })
    }

    async deleteForDeletedAccounts(): Promise<number> {
        const result = await this.prisma.credential.deleteMany({ where: { user: { deletedAt: { not: null } } } })
        return result.count
    }
}
