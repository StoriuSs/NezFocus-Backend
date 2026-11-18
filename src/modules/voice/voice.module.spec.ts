import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { TokenVerifier } from 'livekit-server-sdk'
import { livekitConfig } from '@/config'
import { MEDIA_ROOMS, MediaRoomsPort } from './application'
import { VoiceModule } from './voice.module'

// The module as the app builds it: the LIVEKIT_* variables, read by
// livekit.config.ts, reach the adapter behind MEDIA_ROOMS. The adapter's own
// spec builds its settings by hand, so it cannot see the two drift apart.
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

    it('gives MEDIA_ROOMS the LiveKit of the environment', async () => {
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [livekitConfig] }), VoiceModule]
        }).compile()

        const { token, url } = await module
            .get<MediaRoomsPort>(MEDIA_ROOMS)
            .issueJoinToken({ room: 'voice:c1', identity: 'user-1', name: 'An', sources: [] })

        expect(url).toBe(settings.LIVEKIT_URL)
        const granted = await new TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET).verify(token)
        expect(granted).toMatchObject({ iss: settings.LIVEKIT_API_KEY, sub: 'user-1' })
        await module.close()
    })
})
