import { GetSettingsHandler } from './get-settings.handler'
import { GetSettingsQuery } from './get-settings.query'
import { UserNotFoundError, UserSettings, UserSettingsRepositoryPort } from '@/modules/users/domain'

// GET /users/me/settings: what another browser applies once signed in (REQ-AUTH-08).
describe('GetSettingsHandler', () => {
    const NOW = new Date('2026-11-07T14:47:00Z')
    const settings = { timezone: 'Asia/Tokyo', theme: 'dark', language: 'en' } as UserSettings

    beforeEach(() => jest.useFakeTimers().setSystemTime(NOW))
    afterEach(() => jest.useRealTimers())

    const handlerWith = (row: UserSettings | null) =>
        new GetSettingsHandler({ find: jest.fn().mockResolvedValue(row) } as unknown as UserSettingsRepositoryPort)

    it('returns the settings and when the zone may change again', async () => {
        const changedAt = new Date(NOW.getTime() - 60_000)

        const view = await handlerWith({ ...settings, timezoneChangedAt: changedAt }).execute(
            new GetSettingsQuery('user-1')
        )

        expect(view).toMatchObject({
            theme: 'dark',
            timezoneChangeableAt: new Date(changedAt.getTime() + 24 * 60 * 60 * 1000)
        })
    })

    it('says the zone may change now when it never was', async () => {
        const view = await handlerWith({ ...settings, timezoneChangedAt: null }).execute(new GetSettingsQuery('user-1'))

        expect(view.timezoneChangeableAt).toBeNull()
    })

    it('answers USER_NOT_FOUND when the account is gone', async () => {
        await expect(handlerWith(null).execute(new GetSettingsQuery('user-1'))).rejects.toBeInstanceOf(
            UserNotFoundError
        )
    })
})
