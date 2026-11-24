import { createHash } from 'crypto'
import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { AccessToken, TokenVerifier } from 'livekit-server-sdk'
import { livekitConfig } from '@/config'
import { PRINCIPAL } from '@/modules/auth'
import { AuthModule } from '@/modules/auth/auth.module'
import { PERMISSION_CHECKER } from '@/modules/permissions'
import { PermissionsModule } from '@/modules/permissions/permissions.module'
import { EVENT_PUBLISHER } from '@/modules/realtime'
import { RealtimeModule } from '@/modules/realtime/realtime.module'
import { CHANNEL_DIRECTORY } from '@/modules/servers'
import { ServersModule } from '@/modules/servers/servers.module'
import { USER_DIRECTORY } from '@/modules/users'
import { UsersModule } from '@/modules/users/users.module'
import { REDIS_CLIENT } from '@/shared/infrastructure/cache/redis-client.provider'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import { ACTIVE_CALLS, MEDIA_EVENTS, MEDIA_ROOMS, MediaEventsPort, MediaRoomsPort } from './application'
import { VoiceModule } from './voice.module'

/** What the modules VoiceModule imports give it, and the app's globals, as empty stand-ins: none is called here. */
const stand = (token: symbol) => {
    @Module({ providers: [{ provide: token, useValue: {} }], exports: [token] })
    class StandIn {}
    return StandIn
}

@Global()
@Module({
    providers: [
        { provide: PrismaService, useValue: {} },
        { provide: REDIS_CLIENT, useValue: {} },
        // social's global ActiveCallsModule (D-246)
        { provide: ACTIVE_CALLS, useValue: {} }
    ],
    exports: [PrismaService, REDIS_CLIENT, ACTIVE_CALLS]
})
class GlobalsStandIn {}

// The module as the app builds it: the LIVEKIT_* variables, read by
// livekit.config.ts, reach the adapters behind MEDIA_ROOMS and MEDIA_EVENTS.
// The adapters' own specs build their settings by hand, so they cannot see
// the two drift apart.
describe('VoiceModule (D-204)', () => {
    const settings = {
        LIVEKIT_URL: 'wss://nezfocus-test.livekit.cloud',
        LIVEKIT_API_KEY: 'key-from-the-environment',
        LIVEKIT_API_SECRET: 'environment-'.repeat(3)
    }
    const before = { ...process.env }

    beforeEach(() => Object.assign(process.env, settings))
    afterEach(() => {
        for (const name of Object.keys(settings)) {
            if (before[name] === undefined) delete process.env[name]
            else process.env[name] = before[name]
        }
    })

    const compile = () =>
        Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [livekitConfig] }),
                GlobalsStandIn,
                VoiceModule
            ]
        })
            .overrideModule(AuthModule)
            .useModule(stand(PRINCIPAL))
            .overrideModule(PermissionsModule)
            .useModule(stand(PERMISSION_CHECKER))
            .overrideModule(RealtimeModule)
            .useModule(stand(EVENT_PUBLISHER))
            .overrideModule(ServersModule)
            .useModule(stand(CHANNEL_DIRECTORY))
            .overrideModule(UsersModule)
            .useModule(stand(USER_DIRECTORY))
            .compile()

    it('gives MEDIA_ROOMS the LiveKit of the environment', async () => {
        const module = await compile()

        const { token, url } = await module
            .get<MediaRoomsPort>(MEDIA_ROOMS)
            .issueJoinToken({ room: 'voice:c1', identity: 'user-1', name: 'An', sources: [], sessionId: 'session-1' })

        expect(url).toBe(settings.LIVEKIT_URL)
        const granted = await new TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET).verify(token)
        expect(granted).toMatchObject({ iss: settings.LIVEKIT_API_KEY, sub: 'user-1' })
        await module.close()
    })

    it('has MEDIA_EVENTS take the webhooks signed with the key and secret of the environment', async () => {
        const module = await compile()
        const body = JSON.stringify({ event: 'room_started', id: 'EV_1', room: { name: 'voice:c1' } })
        const signer = new AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        signer.sha256 = createHash('sha256').update(body).digest('base64')

        const event = await module.get<MediaEventsPort>(MEDIA_EVENTS).read(body, await signer.toJwt())

        expect(event).toEqual({ id: 'EV_1', kind: 'other' })
        await module.close()
    })
})
