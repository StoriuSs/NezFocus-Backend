import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { Reflector } from '@nestjs/core'
import { Logger as PinoLogger } from 'nestjs-pino'
import request from 'supertest'
import { UsersController } from '@/modules/users/presentation/http/users.controller'
import { ResolveAvatarUrlQuery } from '@/modules/users/application/queries/resolve-avatar-url/resolve-avatar-url.query'
import { UserEntity } from '@/modules/users/domain'
import { GlobalExceptionFilter } from '@/shared/presentation/filters/global-exception.filter'
import { TransformInterceptor } from '@/shared/presentation/interceptors/transform.interceptor'
import { SnakeToCamelPipe, createValidationPipe } from '@/shared/presentation/pipes'
import { AuthenticatedUser } from '@/shared/types'

type Schema = {
    $ref?: string
    type?: string
    nullable?: boolean
    properties?: Record<string, Schema>
    required?: string[]
    items?: Schema
}

type OpenApi = {
    paths: Record<
        string,
        Record<string, { responses: Record<string, { content?: Record<string, { schema: Schema }> }> }>
    >
    components: { schemas: Record<string, Schema> }
}

// The committed spec, which the React starter generates its types from.
const spec = JSON.parse(readFileSync(resolve(__dirname, '../../openapi.json'), 'utf8')) as OpenApi

/**
 * Checks a value against the subset of OpenAPI the spec uses: required keys,
 * types, nullability, and no keys the spec doesn't declare. Returns the
 * problems found, as paths.
 */
function violations(value: unknown, schema: Schema, path = '$'): string[] {
    if (schema.$ref) return violations(value, spec.components.schemas[schema.$ref.split('/').pop()!], path)
    if (value === null) return schema.nullable || schema.type === 'null' ? [] : [`${path} is null`]
    if (schema.type === 'null') return [`${path} should be null`]

    switch (schema.type) {
        case 'object': {
            if (typeof value !== 'object' || Array.isArray(value)) return [`${path} is not an object`]
            const record = value as Record<string, unknown>
            const properties = schema.properties ?? {}
            return [
                ...(schema.required ?? []).filter((key) => !(key in record)).map((key) => `${path}.${key} is missing`),
                ...Object.keys(record)
                    .filter((key) => !(key in properties))
                    .map((key) => `${path}.${key} is not in the spec`),
                ...Object.entries(record)
                    .filter(([key]) => key in properties)
                    .flatMap(([key, item]) => violations(item, properties[key], `${path}.${key}`))
            ]
        }
        case 'array':
            return Array.isArray(value)
                ? value.flatMap((item, i) => violations(item, schema.items ?? {}, `${path}[${i}]`))
                : [`${path} is not an array`]
        case 'string':
        case 'number':
        case 'boolean':
            return typeof value === schema.type ? [] : [`${path} is ${typeof value}, not ${schema.type}`]
        default:
            return []
    }
}

function responseSchema(method: string, path: string): Schema {
    const schema = spec.paths[path]?.[method]?.responses['200']?.content?.['application/json']?.schema
    if (!schema) throw new Error(`openapi.json documents no 200 response for ${method.toUpperCase()} ${path}`)
    return schema
}

/**
 * What the users routes send, checked against the committed spec. Optional
 * keys that are really always sent (or null that is documented as absent)
 * produce generated client types that lie; this is where that shows up.
 *
 * If a route changes, run `pnpm openapi:export` and commit openapi.json.
 */
describe('OpenAPI contract: users routes (e2e)', () => {
    let app: INestApplication
    const commandBus = { execute: jest.fn() }
    // Answers the avatar URL as the real handler would; a test sets anything else with mockResolvedValueOnce.
    const queryBus = {
        execute: jest.fn(
            async (query: unknown): Promise<unknown> =>
                query instanceof ResolveAvatarUrlQuery
                    ? query.key
                        ? `http://localhost:3000/uploads/${query.key}`
                        : null
                    : undefined
        )
    }
    let currentUser: object

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                { provide: CommandBus, useValue: commandBus },
                { provide: QueryBus, useValue: queryBus },
                { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
                { provide: PinoLogger, useValue: { warn: jest.fn(), error: jest.fn(), log: jest.fn() } }
            ]
        }).compile()

        app = moduleRef.createNestApplication()
        app.setGlobalPrefix('api')
        app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
            req.user = currentUser
            next()
        })
        app.useGlobalPipes(new SnakeToCamelPipe(), createValidationPipe())
        app.useGlobalInterceptors(new TransformInterceptor(moduleRef.get(Reflector)))
        app.useGlobalFilters(new GlobalExceptionFilter(moduleRef.get(PinoLogger)))
        app.enableVersioning({ type: 0, defaultVersion: '1' }) // VersioningType.URI
        await app.init()
    })

    afterAll(async () => {
        await app?.close()
    })

    const newUser: AuthenticatedUser = {
        id: 'user-1',
        sessionId: 'session-1',
        email: null,
        emailVerified: false,
        roles: [],
        username: null,
        displayName: null,
        avatarUrl: null,
        bio: null,
        hasSetUsername: false
    }
    const fullUser: AuthenticatedUser = {
        id: 'user-1',
        sessionId: 'session-1',
        email: 'jane@example.com',
        emailVerified: true,
        roles: ['user'],
        username: 'jane',
        displayName: 'Jane',
        avatarUrl: 'avatars/1.webp',
        bio: 'Hi',
        hasSetUsername: true
    }
    const key = '6f9619ff-8b86-4d11-b42d-00c04fc964ff'

    it('answers what openapi.json promises on every users route, for a user with nothing set and with everything set', async () => {
        const server = app.getHttpServer()
        const check = (res: request.Response, method: string, path: string) =>
            expect({
                route: `${method} ${path}`,
                problems: violations(res.body, responseSchema(method, path))
            }).toEqual({ route: `${method} ${path}`, problems: [] })

        for (const user of [newUser, fullUser]) {
            currentUser = user
            check(await request(server).get('/api/v1/users/me').expect(200), 'get', '/api/v1/users/me')
        }

        currentUser = fullUser
        for (const entity of [
            new UserEntity({ id: 'user-1' }),
            new UserEntity({
                id: 'user-1',
                username: 'jane',
                displayName: 'Jane',
                avatarUrl: 'avatars/1.webp',
                bio: 'Hi',
                hasSetUsername: true
            })
        ]) {
            commandBus.execute.mockResolvedValueOnce(entity)
            const res = await request(server)
                .patch('/api/v1/users/me')
                .set('Idempotency-Key', key)
                .send({ display_name: 'Jane' })
                .expect(200)
            check(res, 'patch', '/api/v1/users/me')
        }

        currentUser = newUser
        commandBus.execute.mockResolvedValueOnce(
            new UserEntity({ id: 'user-1', username: 'jane', hasSetUsername: true })
        )
        const username = await request(server)
            .post('/api/v1/users/me/username')
            .set('Idempotency-Key', key)
            .send({ username: 'jane' })
            .expect(200)
        check(username, 'post', '/api/v1/users/me/username')

        queryBus.execute.mockResolvedValueOnce(false)
        const available = await request(server).get('/api/v1/users/username-available/jane').expect(200)
        check(available, 'get', '/api/v1/users/username-available/{username}')
    })
})
