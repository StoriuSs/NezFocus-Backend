import { INestApplication } from '@nestjs/common'
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import { toSnakeCaseKeys } from '@/shared/utils/case-keys.util'
import basicAuth from 'express-basic-auth'
import { Queue } from 'bullmq'
import { ExpressAdapter } from '@bull-board/express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'

export interface BasicAuthCredentials {
    user: string
    password: string
}

export const API_DOCS_PATH = 'api-docs'
export const QUEUE_DASHBOARD_PATH = '/admin/queues'

/**
 * Both endpoints below are mounted on raw Express: outside the global prefix,
 * and outside every Nest guard, filter and interceptor. Whatever protects them
 * has to be Express middleware registered here.
 */
function basicAuthMiddleware({ user, password }: BasicAuthCredentials, realm: string) {
    return basicAuth({
        // Authorizer form so both halves go through safeCompare: the `users`
        // map compares with ===, which leaks the credential a character at a
        // time under timing analysis. Both comparisons run (no short-circuit)
        // so the timing doesn't reveal which half was wrong.
        authorizer: (givenUser: string, givenPassword: string) => {
            const userMatch = basicAuth.safeCompare(givenUser, user)
            const passwordMatch = basicAuth.safeCompare(givenPassword, password)
            return userMatch && passwordMatch
        },
        challenge: true,
        realm
    })
}

/** The OpenAPI document for the app, with schema names as they are on the wire. */
export function buildApiDocument(app: INestApplication, appName: string): OpenAPIObject {
    const config = new DocumentBuilder()
        .setTitle(`${appName} API`)
        .setDescription('REST API documentation')
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
        // The httpOnly cookie the refresh and logout routes read.
        .addCookieAuth('refresh_token', { type: 'apiKey', in: 'cookie', name: 'refresh_token' }, 'refresh_token')
        .build()
    return snakeCaseSchemas(SwaggerModule.createDocument(app, config))
}

/**
 * OpenAPI documentation generated from the code at boot, at `/api-docs`, with
 * the raw spec at `/api-docs-json` and `/api-docs-yaml`.
 *
 * With `credentials`, all three sit behind basic auth. The middleware has to be
 * registered BEFORE `SwaggerModule.setup`: setup adds its routes to Express
 * immediately, and Express runs handlers in registration order, so auth
 * registered afterwards was never reached — the docs were public in
 * production. The two spec URLs are siblings of `/api-docs`, not children, so
 * mounting on `/api-docs` alone doesn't cover them either.
 */
export function mountApiDocs(app: INestApplication, appName: string, credentials: BasicAuthCredentials | null) {
    if (credentials) {
        app.use(
            [`/${API_DOCS_PATH}`, `/${API_DOCS_PATH}-json`, `/${API_DOCS_PATH}-yaml`],
            basicAuthMiddleware(credentials, 'API Docs')
        )
    }

    SwaggerModule.setup(API_DOCS_PATH, app, buildApiDocument(app, appName), {
        useGlobalPrefix: false,
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: `${appName} API Documentation`,
        swaggerOptions: { persistAuthorization: true }
    })
}

type SchemaNode = { properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown }

/** Exactly the key conversion the API applies, so docs and wire can't differ. */
const snakeKey = (key: string) => Object.keys(toSnakeCaseKeys({ [key]: null }) as object)[0]

function snakeCaseSchema(node: unknown): void {
    if (Array.isArray(node)) return node.forEach(snakeCaseSchema)
    if (!node || typeof node !== 'object') return
    const schema = node as SchemaNode
    if (schema.properties) {
        schema.properties = Object.fromEntries(
            Object.entries(schema.properties).map(([key, value]) => [snakeKey(key), value])
        )
        schema.required = schema.required?.map(snakeKey)
    }
    Object.values(schema).forEach(snakeCaseSchema)
}

/**
 * Rewrite schema property names to snake_case.
 *
 * The Swagger plugin documents DTOs by their TypeScript property names
 * (camelCase), but SnakeToCamelPipe expects snake_case requests and
 * TransformInterceptor sends snake_case responses. Clients generated from
 * the camelCase spec sent fields the API then rejected as unknown.
 */
export function snakeCaseSchemas(document: OpenAPIObject): OpenAPIObject {
    snakeCaseSchema(document.components?.schemas)
    return document
}

/** The BullMQ dashboard at `/admin/queues`, always behind basic auth. */
export function mountQueueDashboard(app: INestApplication, queues: Queue[], credentials: BasicAuthCredentials) {
    const serverAdapter = new ExpressAdapter()
    serverAdapter.setBasePath(QUEUE_DASHBOARD_PATH)

    createBullBoard({
        queues: queues.map((queue) => new BullMQAdapter(queue)),
        serverAdapter
    })

    app.use(QUEUE_DASHBOARD_PATH, basicAuthMiddleware(credentials, 'BullMQ Dashboard'), serverAdapter.getRouter())
}
