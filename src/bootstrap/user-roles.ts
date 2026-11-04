// Gives a user a role, or takes one away. How the first administrator is made
// (docs/auth/accounts.md, "Roles"): on purpose, from the command line, rather
// than by a setting that promotes whoever signs up first.
//
//   pnpm user:promote ada@example.com                   add "admin"
//   pnpm user:promote ada@example.com --role editor     add another role
//   pnpm user:promote ada@example.com --remove          take "admin" away
//
// On a server, in the app's container:
//
//   docker compose --env-file .env.production -f docker-compose.prod.yaml exec app \
//     node dist/src/bootstrap/user-roles.js ada@example.com
//
// The change applies to the user's next request: the cached copy of the user
// the session check reads is dropped. If Redis cannot be reached, it applies
// within five minutes instead, when that copy expires.
import '../config/load-env'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { createClient, RedisClientType } from 'redis'
import { PrismaClient } from '../../generated/prisma/client'
import { invalidate } from '@/shared/infrastructure/cache/versioned-cache'
import { userKey } from '@/modules/auth/infrastructure/adapters/cache-keys'

const ROLE_NAME = /^[a-z][a-z0-9_-]{0,31}$/

export interface RoleCommand {
    email: string
    role: string
    remove: boolean
}

export function parseArgs(argv: string[]): RoleCommand {
    const args = argv.filter((arg) => arg !== '--')
    const email = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--role')
    const roleIndex = args.indexOf('--role')
    const role = roleIndex >= 0 ? args[roleIndex + 1] : 'admin'
    if (!email || !email.includes('@')) {
        throw new Error('Usage: pnpm user:promote <email> [--role <name>] [--remove]')
    }
    if (!role || !ROLE_NAME.test(role)) {
        throw new Error(`"${role ?? ''}" is not a role name: lower-case letters, digits, - and _`)
    }
    return { email: email.trim().toLowerCase(), role, remove: args.includes('--remove') }
}

/** The roles after the change, in a stable order; `user` is never removed. */
export function changeRoles(current: string[], role: string, remove: boolean): string[] {
    if (remove && role === 'user') throw new Error('Every account has the "user" role; it cannot be removed')
    const next = new Set(current)
    if (remove) next.delete(role)
    else next.add(role)
    return [...next].sort((a, b) => (a === 'user' ? -1 : b === 'user' ? 1 : a.localeCompare(b)))
}

async function dropCachedUser(userId: string): Promise<boolean> {
    const redis = createClient({
        socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: Number(process.env.REDIS_PORT || 6379),
            connectTimeout: 5000,
            reconnectStrategy: false
        },
        password: process.env.REDIS_PASSWORD || undefined
    }) as RedisClientType
    redis.on('error', () => undefined)
    try {
        await redis.connect()
        await invalidate(redis, userKey(userId))
        return true
    } catch {
        return false
    } finally {
        await redis.quit().catch(() => undefined)
    }
}

async function main(): Promise<void> {
    const command = parseArgs(process.argv.slice(2))
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    try {
        const user = await prisma.user.findFirst({ where: { email: command.email, deletedAt: null } })
        if (!user) throw new Error(`No account uses ${command.email}`)

        const roles = changeRoles(user.roles, command.role, command.remove)
        if (roles.join() === user.roles.join()) {
            console.log(`${command.email} already has roles: ${roles.join(', ')}. Nothing changed.`)
            return
        }
        await prisma.user.update({ where: { id: user.id }, data: { roles } })
        console.log(`✓ ${command.email}: ${user.roles.join(', ')} → ${roles.join(', ')}`)

        if (!(await dropCachedUser(user.id))) {
            console.warn('⚠ Redis could not be reached: signed-in sessions see the change within five minutes.')
        }
    } finally {
        await prisma.$disconnect()
        await pool.end()
    }
}

if (require.main === module) {
    main().catch((error: Error) => {
        console.error(`✗ ${error.message}`)
        process.exit(1)
    })
}
