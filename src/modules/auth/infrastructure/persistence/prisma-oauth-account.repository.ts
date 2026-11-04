import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { OAuthAccountRepositoryPort } from '@/modules/auth/domain'

@Injectable()
export class PrismaOAuthAccountRepository implements OAuthAccountRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async findUserId(provider: string, subject: string): Promise<string | null> {
        const link = await this.prisma.oAuthAccount.findUnique({
            where: { provider_providerAccountId: { provider, providerAccountId: subject } },
            select: { userId: true }
        })
        return link?.userId ?? null
    }

    async link(userId: string, provider: string, subject: string): Promise<boolean> {
        // Insert or nothing: the unique (provider, subject) index decides a
        // race, not a read before the write.
        const created = await this.prisma.oAuthAccount.createMany({
            data: [{ userId, provider, providerAccountId: subject }],
            skipDuplicates: true
        })
        if (created.count === 1) return true
        return (await this.findUserId(provider, subject)) === userId
    }

    async providersOf(userId: string): Promise<string[]> {
        const links = await this.prisma.oAuthAccount.findMany({
            where: { userId },
            select: { provider: true },
            distinct: ['provider'],
            orderBy: { provider: 'asc' }
        })
        return links.map((link) => link.provider)
    }

    async deleteForUser(userId: string): Promise<void> {
        await this.prisma.oAuthAccount.deleteMany({ where: { userId } })
    }

    async deleteForDeletedAccounts(): Promise<number> {
        const result = await this.prisma.oAuthAccount.deleteMany({ where: { user: { deletedAt: { not: null } } } })
        return result.count
    }
}
