// Writes the OpenAPI document to openapi.json, for client code generation.
//
//   pnpm openapi:export   write openapi.json
//   pnpm openapi:check    fail if openapi.json is out of date with the code
//
// Runs from a compiled app: the Swagger CLI plugin that reads DTO properties
// only runs during `nest build`. It is built into dist-openapi/ (see
// nest-cli.openapi.json) so it never wipes dist/, which a running dev container
// serves from. The app is created in preview mode, so nothing connects to a
// database or Redis. See docs/openapi.md.
import '../config/load-env'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { config } from 'dotenv'

// Anything the env file didn't set comes from .env.example. The configuration
// schema is validated when AppModule is imported, and a fresh clone or a CI
// runner has no .env.development — the export failed there. Nothing connects
// anywhere, so placeholder values are enough.
config({ path: resolve(process.cwd(), '.env.example'), quiet: true })

async function main() {
    // Imported after the fallback above, which validation depends on.
    const { NestFactory } = await import('@nestjs/core')
    const { AppModule } = await import('../app.module')
    const { buildApiDocument } = await import('./operational-endpoints')

    const check = process.argv.includes('--check')
    const file = resolve(process.cwd(), process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'openapi.json')
    // The title comes from package.json, not APP_NAME, so every machine
    // produces the same file. The served docs at /api-docs still use APP_NAME.
    const { name } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { name: string }

    const app = await NestFactory.create(AppModule, { preview: true, logger: ['error'] })
    app.setGlobalPrefix(process.env.API_PREFIX || 'api')
    app.enableVersioning({ type: 0, defaultVersion: '1' }) // VersioningType.URI
    const content = JSON.stringify(buildApiDocument(app, name), null, 2) + '\n'
    await app.close()

    if (check) {
        // Line endings are normalised: git may check the file out with CRLF.
        const committed = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : ''
        if (committed !== content) {
            console.error(`${file} is out of date with the code. Run \`pnpm openapi:export\` and commit it.`)
            process.exit(1)
        }
        console.log(`${file} is up to date`)
        return
    }

    writeFileSync(file, content)
    console.log(`Wrote ${file}`)
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
