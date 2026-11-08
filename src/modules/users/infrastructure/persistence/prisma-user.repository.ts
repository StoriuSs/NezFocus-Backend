import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    AccountCompletion,
    DeletedAccount,
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

    async findTimeZone(id: string): Promise<string | null> {
        const settings = await this.prisma.userSettings.findUnique({
            where: { userId: id },
            select: { timezone: true }
        })
        return settings?.timezone ?? null
    }

    async replaceAvatar(
        id: string,
        avatarKey: string | null
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

    async requestDeletion(id: string, at: Date): Promise<UserEntity | null> {
        try {
            const user = await this.prisma.user.update({
                where: { id, deletedAt: null, completedAt: { not: null }, deletionRequestedAt: null },
                data: { deletionRequestedAt: at }
            })
            return UserMapper.toDomain(user)
        } catch (error: unknown) {
            if (prismaCode(error) === 'P2025') return null
            throw error
        }
    }

    async cancelDeletion(id: string): Promise<boolean> {
        const result = await this.prisma.user.updateMany({
            where: { id, deletedAt: null, deletionRequestedAt: { not: null } },
            data: { deletionRequestedAt: null }
        })
        return result.count > 0
    }

    async deleteDue(due: { requestedBy: Date; incompleteSince: Date }, now: Date): Promise<DeletedAccount[]> {
        return this.prisma.$transaction(async (tx) => {
            // The subquery's FOR UPDATE locks each row and, when it had to wait
            // (a restore, a completion), reads it again and skips it if it no
            // longer matches. The outer UPDATE returns the avatar key as it
            // was, so its file can be removed. A person who asked is recorded
            // as the one who deleted it; an abandoned sign-up, nobody.
            // At most 200 a run: the next sweep, 15 minutes later, takes the rest.
            const rows = await tx.$queryRaw<DeletedAccount[]>`
                UPDATE "User" AS u
                SET "deletedAt" = ${now},
                    "deletedBy" = CASE WHEN old."deletionRequestedAt" IS NULL THEN NULL ELSE u."id" END,
                    "email" = NULL, "username" = NULL, "displayName" = NULL, "bio" = NULL, "avatarUrl" = NULL,
                    "updatedAt" = ${now}
                FROM (
                    SELECT "id", "avatarUrl", "deletionRequestedAt" FROM "User"
                    WHERE "deletedAt" IS NULL
                      AND ("deletionRequestedAt" <= ${due.requestedBy}
                           OR ("completedAt" IS NULL AND "createdAt" <= ${due.incompleteSince}))
                    ORDER BY "id"
                    LIMIT 200
                    FOR UPDATE
                ) AS old
                WHERE u."id" = old."id"
                RETURNING u."id" AS id, old."avatarUrl" AS "avatarKey",
                          (old."deletionRequestedAt" IS NOT NULL) AS "ownerAsked"
            `
            // The settings are personal too (time zone, language).
            if (rows.length > 0) {
                await tx.userSettings.deleteMany({ where: { userId: { in: rows.map((row) => row.id) } } })
            }
            return rows
        })
    }

    async findAnyById(id: string): Promise<UserEntity | null> {
        const user = await this.prisma.user.findUnique({ where: { id } })
        return user ? UserMapper.toDomain(user) : null
    }

    async findLiveByEmail(email: string): Promise<UserEntity | null> {
        // Every sign-in, code and reset looks an address up here, so it must
        // use an index. The only one on the address is the partial unique
        // index User_email_active_key on lower("email") for live accounts, and
        // Postgres uses it only for a query on that same expression with that
        // same condition: `email = $1` (what Prisma writes) reads the whole
        // table. So the id comes from raw SQL, then the row by its key.
        const [found] = await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "User"
            WHERE lower("email") = lower(${normaliseEmail(email)})
              AND "deletedAt" IS NULL AND "email" IS NOT NULL
            LIMIT 1`
        if (!found) return null
        const user = await this.prisma.user.findUnique({ where: { id: found.id } })
        return user && !user.deletedAt ? UserMapper.toDomain(user) : null
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
