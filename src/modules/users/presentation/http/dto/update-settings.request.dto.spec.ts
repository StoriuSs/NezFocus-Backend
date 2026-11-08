import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { UpdateSettingsRequestDto } from './update-settings.request.dto'

// PATCH /users/me/settings: what each field may be (SRS 7.1, REQ-AUTH-08).
describe('UpdateSettingsRequestDto', () => {
    const problems = async (body: object) => {
        // As the global pipe converts (app-validation.pipe.ts): implicit conversion on.
        const errors = await validate(
            plainToInstance(UpdateSettingsRequestDto, body, { enableImplicitConversion: true })
        )
        return errors.map((error) => error.property)
    }

    it('takes any subset of the fields, each as it should be', async () => {
        expect(
            await problems({
                theme: 'dark',
                language: 'en',
                timezone: ' Asia/Tokyo ',
                phaseSound: false,
                browserNotifications: true,
                notifyMentions: false,
                notifyDirectMessages: false,
                notifyIncomingCalls: false,
                notifyPhaseChanges: false,
                notificationPromptDismissed: true,
                allowServerMemberMessages: false,
                showStudyActivity: false
            })
        ).toEqual([])
        expect(await problems({})).toEqual([])
    })

    it('refuses a theme or language it does not know', async () => {
        expect(await problems({ theme: 'sepia', language: 'fr' })).toEqual(['language', 'theme'])
    })

    it('refuses an offset or a made-up zone instead of a zone name', async () => {
        for (const timezone of ['+07:00', 'Etc/GMT-7', 'Mars/Olympus', 7]) {
            expect(await problems({ timezone })).toEqual(['timezone'])
        }
    })

    it('refuses null and strings for the switches, rather than reading them as off', async () => {
        expect(await problems({ phaseSound: null, showStudyActivity: 'false', theme: null })).toEqual([
            'theme',
            'phaseSound',
            'showStudyActivity'
        ])
    })
})
