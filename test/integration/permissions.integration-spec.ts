import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient, RedisClientType } from 'redis'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { PrismaAccessSource } from '@/modules/permissions/infrastructure/persistence/prisma-access-source.adapter'
import {
    memberKey,
    RedisPermissionChecker,
    serverKey
} from '@/modules/permissions/infrastructure/adapters/redis-permission-checker.adapter'
import { channelPermissions, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { databaseTarget, redisTarget } from './targets'

/**
 * The permission cache against real Postgres and Redis (REQ-ROLE-05, D-146):
 * a change shows at the next check once the servers module reports it, and
 * what comes back from Redis is the same as what went in.
 *
 * Requires Postgres and Redis: `pnpm test:services:up`, then `pnpm test:integration`.
 */
describe('Permission checker (integration)', () => {
    let pool: Pool
    let prisma: PrismaClient
    let redis: RedisClientType
    let checker: RedisPermissionChecker
    const servers: string[] = []

    const metrics = { recordCacheHit: () => undefined, recordCacheMiss: () => undefined } as unknown as MetricsService

    beforeAll(async () => {
        pool = new Pool({ connectionString: databaseTarget.url, max: 10 })
        prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
        redis = createClient({
            socket: { host: redisTarget.host, port: redisTarget.port },
            password: redisTarget.password || undefined
        })
        await redis.connect()
        const source = new PrismaAccessSource(prisma as unknown as PrismaService)
        checker = new RedisPermissionChecker(redis, source, metrics)
    })

    afterAll(async () => {
        for (const id of servers) {
            for await (const keys of redis.scanIterator({ MATCH: `perm:*${id}*`, COUNT: 100 })) {
                if (keys.length) await redis.del(keys)
            }
        }
        await prisma.server.deleteMany({ where: { id: { in: servers } } })
        await prisma.user.deleteMany({ where: { id: { startsWith: 'itest-perm-' } } })
        await redis.quit()
        await prisma.$disconnect()
        await pool.end()
    })

    /** A server with an owner, @everyone, one text channel and one plain member. */
    async function world() {
        const owner = await prisma.user.create({ data: { id: `itest-perm-${randomUUID()}` } })
        const person = await prisma.user.create({ data: { id: `itest-perm-${randomUUID()}` } })
        const server = await prisma.server.create({ data: { name: 'Lớp 12A', ownerId: owner.id } })
        servers.push(server.id)
        const everyone = await prisma.role.create({
            data: {
                serverId: server.id,
                name: '@everyone',
                nameKey: '@everyone',
                position: 0,
                isEveryone: true,
                permissions: EVERYONE_DEFAULT_PERMISSIONS
            }
        })
        const channel = await prisma.channel.create({
            data: { serverId: server.id, type: 'text', name: 'chung', nameKey: 'chung', position: 0 }
        })
        await prisma.member.createMany({
            data: [
                { serverId: server.id, userId: owner.id },
                { serverId: server.id, userId: person.id }
            ]
        })
        return { owner, person, server, everyone, channel }
    }

    const sendIn = async (serverId: string, userId: string, channelId: string) => {
        const access = await checker.access(serverId, userId)
        if (!access) return null
        const channel = access.server.channels.find((c) => c.id === channelId)
        if (!channel) return null
        return (channelPermissions(access.server, access.member, channel, new Date()) & Permission.SEND_MESSAGES) !== 0n
    }

    it('answers null for someone outside the server, and does not remember that', async () => {
        const { server } = await world()
        const outsider = await prisma.user.create({ data: { id: `itest-perm-${randomUUID()}` } })

        expect(await checker.access(server.id, outsider.id)).toBeNull()

        // Joining needs no invalidation to be seen: nothing was cached.
        await prisma.member.create({ data: { serverId: server.id, userId: outsider.id } })
        expect(await checker.access(server.id, outsider.id)).not.toBeNull()
    })

    it('answers null for a deleted server once the change is reported', async () => {
        const { server, person } = await world()
        expect(await checker.access(server.id, person.id)).not.toBeNull()

        await prisma.server.update({ where: { id: server.id }, data: { deletedAt: new Date() } })
        await checker.serverChanged(server.id)

        expect(await checker.access(server.id, person.id)).toBeNull()
    })

    it('serves the cached server until serverChanged, then the new rules', async () => {
        const { server, person, everyone, channel } = await world()
        expect(await sendIn(server.id, person.id, channel.id)).toBe(true)

        await prisma.role.update({
            where: { id: everyone.id },
            data: { permissions: EVERYONE_DEFAULT_PERMISSIONS & ~Permission.SEND_MESSAGES }
        })
        // Not reported yet: the cache still answers (proves it is used).
        expect(await sendIn(server.id, person.id, channel.id)).toBe(true)

        await checker.serverChanged(server.id)
        expect(await sendIn(server.id, person.id, channel.id)).toBe(false)
    })

    it('serves the cached member until memberChanged, then their new roles', async () => {
        const { server, person, channel } = await world()
        await prisma.channel.update({ where: { id: channel.id }, data: { sendMode: 'managers' } })
        await checker.serverChanged(server.id)
        expect(await sendIn(server.id, person.id, channel.id)).toBe(false)

        const mods = await prisma.role.create({
            data: {
                serverId: server.id,
                name: 'Quản lý',
                nameKey: 'quản lý',
                position: 1,
                permissions: Permission.MANAGE_MESSAGES
            }
        })
        await prisma.memberRole.create({ data: { serverId: server.id, userId: person.id, roleId: mods.id } })
        await checker.serverChanged(server.id) // the new role
        expect(await sendIn(server.id, person.id, channel.id)).toBe(false) // their entry: not yet

        await checker.memberChanged(server.id, person.id)
        expect(await sendIn(server.id, person.id, channel.id)).toBe(true)
    })

    it('brings a timeout and the role bits back from Redis as they went in', async () => {
        const { server, person, channel } = await world()
        const until = new Date(Date.now() + 60 * 60_000)
        await prisma.member.update({
            where: { serverId_userId: { serverId: server.id, userId: person.id } },
            data: { timeoutUntil: until }
        })

        const fromDatabase = await checker.access(server.id, person.id)
        expect(await redis.exists([serverKey(server.id), memberKey(server.id, person.id)])).toBe(2)
        const fromCache = await checker.access(server.id, person.id)

        expect(fromCache).toEqual(fromDatabase)
        expect(fromCache?.member.timeoutUntil).toEqual(until)
        expect(await sendIn(server.id, person.id, channel.id)).toBe(false)
    })

    it('sees the private channels and the roles allowed in them', async () => {
        const { server, person, owner } = await world()
        const team = await prisma.role.create({
            data: { serverId: server.id, name: 'Nhóm', nameKey: 'nhóm', position: 1 }
        })
        const secret = await prisma.channel.create({
            data: { serverId: server.id, type: 'text', name: 'bi-mat', nameKey: 'bi-mat', position: 1, isPrivate: true }
        })
        await prisma.channelViewRole.create({ data: { channelId: secret.id, roleId: team.id, serverId: server.id } })

        const access = await checker.access(server.id, person.id)
        const channel = access?.server.channels.find((c) => c.id === secret.id)
        expect(channel?.viewRoleIds).toEqual([team.id])
        expect(channelPermissions(access!.server, access!.member, channel!, new Date())).toBe(0n)

        const ownerAccess = await checker.access(server.id, owner.id)
        expect(channelPermissions(ownerAccess!.server, ownerAccess!.member, channel!, new Date())).not.toBe(0n)
    })
})
