import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    AccountCompletion,
    normaliseEmail,
    UserEntity,
    UsernameTakenError,
    UserNotFoundError,
    UserRepositoryPort
} from '@/modules/users/domain'
import { UserMapper } from '../mappers/user.mapper'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/**
 * Prisma User Repository — Outbound Adapter
 *
 * Implements the UserRepositoryPort using Prisma as the persistence layer.
 * All Prisma-specific concerns (error codes, types, queries) are contained here.
 * The domain/application layers never see Prisma.
 */
@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async findById(id: string): Promise<UserEntity | null> {
        const user = await this.prisma.user.findFirst({
            where: { id, deletedAt: null }
        })
        return user ? UserMapper.toDomain(user) : null
    }

    async findByUsername(username: string): Promise<UserEntity | null> {
        // findFirst, not findUnique: uniqueness is enforced by a partial
        // case-insensitive index that Prisma cannot model, so `username` is not
        // a unique field in the generated client. Soft-deleted rows are
        // excluded so a deleted account does not make its handle look taken.
        const user = await this.prisma.user.findFirst({
            where: { username, deletedAt: null }
        })
        return user ? UserMapper.toDomain(user) : null
    }

    async update(id: string, data: Partial<Pick<UserEntity, 'displayName' | 'bio'>>): Promise<UserEntity> {
        try {
            const user = await this.prisma.user.update({
                // `deletedAt: null`: a caller holding a stale id must not be
                // able to mutate a deleted account.
                where: { id, deletedAt: null },
                data: UserMapper.toPersistence(data)
            })
            return UserMapper.toDomain(user)
        } catch (error: unknown) {
            // P2025 — no row matched, i.e. the user is gone or soft-deleted.
            if (prismaCode(error) === 'P2025') {
                throw new UserNotFoundError(id)
            }
            throw error
        }
    }

    /**
     * The `completedAt: null` guard is in the UPDATE's WHERE clause, so the
     * check and the write are one statement: of two submissions at once, one
     * completes the account and the other finds nothing to update. The
     * settings row is written in the same transaction, so a completed account
     * always has one.
     */
    async complete(id: string, completion: AccountCompletion): Promise<UserEntity | null> {
        const { displayName, username, passwordHash, timezone, language, completedAt } = completion
        try {
            return await this.prisma.$transaction(async (tx) => {
                const result = await tx.user.updateMany({
                    where: { id, deletedAt: null, completedAt: null },
                    data: { displayName, username, completedAt, termsAcceptedAt: completedAt }
                })
                if (result.count === 0) return null

                // The password goes in the same transaction: a completion that
                // lost (completed meanwhile, username taken) writes no password,
                // and a completed account always has one (D-130). The table is
                // auth's; the one write across the module line, kept here so it
                // cannot happen apart from the completion.
                await tx.credential.upsert({
                    where: { userId: id },
                    create: { userId: id, passwordHash },
                    update: { passwordHash, passwordUpdatedAt: completedAt }
                })

                // An upsert, so a username clash is the only unique violation here.
                await tx.userSettings.upsert({
                    where: { userId: id },
                    create: { userId: id, timezone, language },
                    update: { timezone, language }
                })
                const user = await tx.user.findUniqueOrThrow({ where: { id } })
                return UserMapper.toDomain(user)
            })
        } catch (error: unknown) {
            // The partial, case-insensitive index on usernames of live accounts.
            if (prismaCode(error) === 'P2002') throw new UsernameTakenError(username)
            throw error
        }
    }

    async findLanguage(id: string): Promise<string | null> {
        const settings = await this.prisma.userSettings.findUnique({
            where: { userId: id },
            select: { language: true }
        })
        return settings?.language ?? null
    }

    async replaceAvatar(
        id: string,
        avatarKey: string
    ): Promise<{ user: UserEntity; previousAvatarKey: string | null } | null> {
        // The subquery's FOR UPDATE locks the row, so a concurrent upload waits
        // and then reads the key this one wrote. Each statement returns the
        // key it actually replaced.
        const rows = await this.prisma.$queryRaw<{ previous: string | null }[]>`
            UPDATE "User" AS u
            SET "avatarUrl" = ${avatarKey}, "updatedAt" = now()
            FROM (SELECT "id", "avatarUrl" FROM "User" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE) AS old
            WHERE u."id" = old."id"
            RETURNING old."avatarUrl" AS previous
        `
        if (rows.length === 0) return null

        const user = await this.prisma.user.findUniqueOrThrow({ where: { id } })
        return { user: UserMapper.toDomain(user), previousAvatarKey: rows[0].previous }
    }

    async softDelete(id: string, deletedBy: string): Promise<UserEntity | null> {
        try {
            // One UPDATE ... WHERE "deletedAt" IS NULL ... RETURNING: the row
            // comes back as it was deleted, with the avatar it held at that
            // instant — an upload finishing just before is included, one just
            // after finds the row deleted and removes its own file.
            const user = await this.prisma.user.update({
                where: { id, deletedAt: null },
                data: { deletedAt: new Date(), deletedBy }
            })
            return UserMapper.toDomain(user)
        } catch (error: unknown) {
            if (prismaCode(error) === 'P2025') return null
            throw error
        }
    }

    async erasePersonalDataDeletedBefore(deletedBefore: Date): Promise<number> {
        const result = await this.prisma.user.updateMany({
            where: {
                deletedAt: { lt: deletedBefore },
                OR: [
                    { email: { not: null } },
                    { username: { not: null } },
                    { displayName: { not: null } },
                    { bio: { not: null } },
                    { avatarUrl: { not: null } }
                ]
            },
            data: { email: null, username: null, displayName: null, bio: null, avatarUrl: null }
        })
        return result.count
    }

    async findAnyById(id: string): Promise<UserEntity | null> {
        const user = await this.prisma.user.findUnique({ where: { id } })
        return user ? UserMapper.toDomain(user) : null
    }

    async findLiveByEmail(email: string): Promise<UserEntity | null> {
        // findFirst: the uniqueness is a partial index Prisma cannot model.
        // Addresses are stored lower case, so an equality match is enough and
        // uses that index's column expression only through `mode` — which
        // would bypass it; comparing the normalised value keeps it simple.
        const user = await this.prisma.user.findFirst({
            where: { email: normaliseEmail(email), deletedAt: null }
        })
        return user ? UserMapper.toDomain(user) : null
    }

    async createWithEmail(email: string, options: { displayName?: string | null } = {}): Promise<UserEntity | null> {
        try {
            const user = await this.prisma.user.create({
                data: { email: normaliseEmail(email), displayName: options.displayName ?? null }
            })
            return UserMapper.toDomain(user)
        } catch (error: unknown) {
            // User_email_active_key: a live account has the address.
            if (prismaCode(error) === 'P2002') return null
            throw error
        }
    }

    async setRoles(id: string, roles: string[]): Promise<UserEntity | null> {
        try {
            const user = await this.prisma.user.update({ where: { id, deletedAt: null }, data: { roles } })
            return UserMapper.toDomain(user)
        } catch (error: unknown) {
            if (prismaCode(error) === 'P2025') return null
            throw error
        }
    }
}
