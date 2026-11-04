import { Test } from '@nestjs/testing'
import { INestApplication, Type, VersioningType } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import request from 'supertest'
import { AUTH_CONTROLLERS, AuthCookies, OAuthController } from '@/modules/auth/presentation'
import {
    GetAuthOptionsQuery,
    GetSignInMethodsQuery,
    GetTwoFactorStatusQuery,
    StartOAuthCommand
} from '@/modules/auth/application'

/**
 * The /auth routes live in five controllers, and one of them,
 * OAuthController, has `GET auth/:provider`, which matches any
 * `GET auth/<word>`. Express takes the first route that matches, in the order
 * the controllers are registered, so AUTH_CONTROLLERS keeps OAuthController
 * last. These GET routes are the ones it would otherwise take.
 */
const STATIC_GETS: [path: string, query: Type][] = [
    ['/api/v1/auth/2fa', GetTwoFactorStatusQuery],
    ['/api/v1/auth/sign-in-methods', GetSignInMethodsQuery],
    ['/api/v1/auth/options', GetAuthOptionsQuery]
]

describe('The /auth routes across their controllers (e2e)', () => {
    const commandBus = { execute: jest.fn().mockResolvedValue({ state: 's', authorizationUrl: 'https://idp.test' }) }
    const queryBus = { execute: jest.fn().mockResolvedValue({}) }

    async function boot(controllers: Type[]): Promise<INestApplication> {
        const settings: Record<string, unknown> = {
            'auth.cookie': { name: 'refresh_token', sameSite: 'strict', secure: false },
            'app.apiPrefix': 'api',
            'app.frontendUrl': 'http://localhost:3001',
            'cors.origins': ['http://localhost:3001']
        }
        const moduleRef = await Test.createTestingModule({
            controllers,
            providers: [
                AuthCookies,
                { provide: CommandBus, useValue: commandBus },
                { provide: QueryBus, useValue: queryBus },
                { provide: ConfigService, useValue: { get: (key: string) => settings[key] } }
            ]
        }).compile()
        const app = moduleRef.createNestApplication()
        app.setGlobalPrefix('api')
        app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
            req.user = { id: 'user-1', sessionId: 'session-1' }
            next()
        })
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
        await app.init()
        return app
    }

    beforeEach(() => jest.clearAllMocks())

    it('reach their own handlers, in the order the module registers the controllers', async () => {
        const app = await boot(AUTH_CONTROLLERS)
        try {
            for (const [path, query] of STATIC_GETS) {
                queryBus.execute.mockClear()
                await request(app.getHttpServer()).get(path)
                expect([path, queryBus.execute.mock.calls[0]?.[0]]).toEqual([path, expect.any(query)])
            }
            expect(commandBus.execute).not.toHaveBeenCalled()

            // And a provider still starts a sign-in.
            const google = await request(app.getHttpServer()).get('/api/v1/auth/google')
            expect(google.status).toBe(302)
            expect(commandBus.execute.mock.calls[0][0]).toEqual(new StartOAuthCommand('google', undefined))
        } finally {
            await app.close()
        }
    })

    it('would be taken for a provider called "2fa" with OAuthController registered first', async () => {
        const app = await boot([OAuthController, ...AUTH_CONTROLLERS.filter((c) => c !== OAuthController)])
        try {
            await request(app.getHttpServer()).get('/api/v1/auth/2fa')
            expect(queryBus.execute).not.toHaveBeenCalled()
            expect(commandBus.execute.mock.calls[0][0]).toEqual(new StartOAuthCommand('2fa', undefined))
        } finally {
            await app.close()
        }
    })
})
