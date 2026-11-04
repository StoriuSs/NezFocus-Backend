import path from 'path'
import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// Load the same env file the app uses (.env.development unless NODE_ENV says
// otherwise), without overriding variables already set. `dotenv/config` read
// only `.env`, which this project never creates — so every bare Prisma command
// (`pnpm exec prisma migrate reset`, `prisma studio`) failed on DATABASE_URL.
// In containers the variables come from the environment and no file exists.
config({ path: path.resolve(__dirname, `.env.${process.env.NODE_ENV || 'development'}`), quiet: true })

export default defineConfig({
    schema: 'prisma/',
    migrations: {
        path: 'prisma/migrations',
        // Prisma 7 reads the seed command here; package.json#prisma is ignored.
        seed: 'ts-node --transpile-only prisma/seed.ts'
    },
    datasource: {
        url: env('DATABASE_URL'),
        // An empty scratch database for `pnpm prisma:check`, which replays the
        // migrations there. Other commands don't need it.
        shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL
    }
})
