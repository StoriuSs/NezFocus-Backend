import path from 'path'
import { config } from 'dotenv'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

/**
 * Seeds example data for local development and demos.
 *
 * Run with: pnpm prisma:seed (also runs after `pnpm prisma:reset`).
 *
 * Real users register through the API, so these rows only matter for screens
 * that list other users. They have no password, so nobody can sign in as them.
 * Safe to run repeatedly: rows are upserted by their fixed ids.
 */
config({ path: path.resolve(__dirname, `../.env.${process.env.NODE_ENV || 'development'}`), quiet: true })

const DEMO_USERS = [
    {
        id: 'seed-demo-user-1',
        email: 'jane.demo@example.test',
        username: 'demo_jane',
        displayName: 'Jane Demo',
        bio: 'UX designer and accessibility advocate.'
    },
    {
        id: 'seed-demo-user-2',
        email: 'john.demo@example.test',
        username: 'demo_john',
        displayName: 'John Demo',
        bio: 'Full-stack developer who likes clean code.'
    }
]

async function main() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to seed demo data into a production database.')
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
    try {
        for (const user of DEMO_USERS) {
            await prisma.user.upsert({
                where: { id: user.id },
                create: { ...user, emailVerified: true, hasSetUsername: true },
                update: {}
            })
        }
        console.log(`Seeded ${DEMO_USERS.length} demo users`)
    } finally {
        await prisma.$disconnect()
        await pool.end()
    }
}

main().catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
})
