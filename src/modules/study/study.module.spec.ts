import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { studyConfig } from '@/config'
import { STUDY_SETTINGS, StudySettings } from './application'
import { StudyModule } from './study.module'

// The module's own providers as the app builds them: STUDY_MINUTE_MS, read
// by study.config.ts, reaches STUDY_SETTINGS. The end-to-end tests shorten
// study minutes through it (D-221); a name drifting between the two would
// leave them on real minutes, waiting for phases that end too late. The study
// queue is left out: it would connect to Redis.
describe('StudyModule (D-221)', () => {
    const before = process.env.STUDY_MINUTE_MS

    afterEach(() => {
        if (before === undefined) delete process.env.STUDY_MINUTE_MS
        else process.env.STUDY_MINUTE_MS = before
    })

    async function settingsWith(minuteMs: string | undefined, load = [studyConfig]): Promise<StudySettings> {
        if (minuteMs === undefined) delete process.env.STUDY_MINUTE_MS
        else process.env.STUDY_MINUTE_MS = minuteMs
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load })],
            providers: Reflect.getMetadata('providers', StudyModule)
        }).compile()
        const settings = module.get<StudySettings>(STUDY_SETTINGS)
        await module.close()
        return settings
    }

    it('gives STUDY_SETTINGS the minute of the environment', async () => {
        expect(await settingsWith('1000')).toEqual({ minuteMs: 1000 })
    })

    it('counts real minutes when the environment says nothing', async () => {
        expect(await settingsWith(undefined)).toEqual({ minuteMs: 60_000 })
    })

    // Joi's number() lets "6e4" through as 60000, even in production: the
    // config must read the same number, not parseInt's 6.
    it('reads the minute as the validation reads it', async () => {
        expect(await settingsWith('6e4')).toEqual({ minuteMs: 60_000 })
        expect(await settingsWith(' 1000 ')).toEqual({ minuteMs: 1000 })
    })

    it('refuses to start without the study config, rather than time every job at NaN', async () => {
        await expect(settingsWith('1000', [])).rejects.toThrow('study.minuteMs')
    })
})
