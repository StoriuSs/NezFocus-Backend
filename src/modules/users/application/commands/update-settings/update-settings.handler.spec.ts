import { UpdateSettingsHandler } from './update-settings.handler'
import { UpdateSettingsCommand } from './update-settings.command'
import {
    SettingsChanges,
    TIMEZONE_CHANGE_INTERVAL_MS,
    TimezoneChange,
    TimezoneChangeTooSoonError,
    UserNotFoundError,
    UserSettings,
    UserSettingsRepositoryPort
} from '@/modules/users/domain'

/**
 * The settings as the repository keeps them, with the same rule as its SQL:
 * a zone change is written only if the zone was never changed in the
 * settings or last changed at or before `lastChangeBefore`.
 */
class InMemorySettings implements UserSettingsRepositoryPort {
    readonly rows = new Map<string, UserSettings>()
    /** Runs between the handler's read and its write: a request from another tab. */
    beforeWrite?: () => void

    async find(userId: string) {
        const row = this.rows.get(userId)
        return row ? { ...row } : null
    }

    async update(userId: string, changes: SettingsChanges, zone?: TimezoneChange) {
        this.beforeWrite?.()
        const row = this.rows.get(userId)
        if (!row) return null
        if (zone && row.timezoneChangedAt && row.timezoneChangedAt > zone.lastChangeBefore) return null
        const next = { ...row, ...changes, ...(zone ? { timezone: zone.timezone, timezoneChangedAt: zone.at } : {}) }
        this.rows.set(userId, next)
        return { ...next }
    }
}

// PATCH /users/me/settings (S-ME-04 → S-ME-06, REQ-AUTH-08, D-131).
describe('UpdateSettingsHandler', () => {
    const NOW = new Date('2026-11-07T14:47:00Z')
    const HOUR = 60 * 60 * 1000

    const completed = (): UserSettings => ({
        timezone: 'Asia/Ho_Chi_Minh',
        timezoneChangedAt: null,
        language: 'vi',
        theme: 'system',
        phaseSound: true,
        browserNotifications: false,
        notifyMentions: true,
        notifyDirectMessages: true,
        notifyIncomingCalls: true,
        notifyPhaseChanges: true,
        notificationPromptDismissed: false,
        allowServerMemberMessages: true,
        showStudyActivity: true
    })

    function world(settings: UserSettings | null = completed()) {
        const repo = new InMemorySettings()
        if (settings) repo.rows.set('user-1', settings)
        return { repo, handler: new UpdateSettingsHandler(repo) }
    }

    const update = (handler: UpdateSettingsHandler, changes: UpdateSettingsCommand['changes']) =>
        handler.execute(new UpdateSettingsCommand('user-1', changes))

    beforeEach(() => jest.useFakeTimers().setSystemTime(NOW))
    afterEach(() => jest.useRealTimers())

    it('saves the choices and switches it is sent and leaves the others', async () => {
        const { repo, handler } = world()

        const view = await update(handler, { theme: 'dark', phaseSound: false, showStudyActivity: false })

        expect(view).toMatchObject({ theme: 'dark', phaseSound: false, showStudyActivity: false, language: 'vi' })
        expect(repo.rows.get('user-1')).toMatchObject({ theme: 'dark', allowServerMemberMessages: true })
    })

    it('changes the zone at once after completing the account, and starts the 24 hours', async () => {
        const { handler } = world()

        const view = await update(handler, { timezone: 'Asia/Tokyo' })

        expect(view).toMatchObject({
            timezone: 'Asia/Tokyo',
            timezoneChangedAt: NOW,
            timezoneChangeableAt: new Date(NOW.getTime() + TIMEZONE_CHANGE_INTERVAL_MS)
        })
    })

    it('refuses a second change within 24 hours, saying when, and writes nothing sent with it', async () => {
        const { repo, handler } = world({ ...completed(), timezoneChangedAt: new Date(NOW.getTime() - HOUR) })

        const refused = update(handler, { timezone: 'Asia/Tokyo', theme: 'dark' })

        await expect(refused).rejects.toBeInstanceOf(TimezoneChangeTooSoonError)
        await expect(refused).rejects.toMatchObject({
            retryAfterSeconds: 23 * 60 * 60,
            details: { reason: 'timezone', changeableAt: new Date(NOW.getTime() + 23 * HOUR).toISOString() }
        })
        expect(repo.rows.get('user-1')).toMatchObject({ timezone: 'Asia/Ho_Chi_Minh', theme: 'system' })
    })

    it('allows the next change once 24 hours have passed', async () => {
        const { handler } = world({
            ...completed(),
            timezoneChangedAt: new Date(NOW.getTime() - TIMEZONE_CHANGE_INTERVAL_MS)
        })

        await expect(update(handler, { timezone: 'Asia/Tokyo' })).resolves.toMatchObject({ timezone: 'Asia/Tokyo' })
    })

    it('takes the zone already in use as no change: no clock starts, even within the 24 hours', async () => {
        const changed = new Date(NOW.getTime() - HOUR)
        const { handler } = world({ ...completed(), timezoneChangedAt: changed })

        const view = await update(handler, { timezone: 'Asia/Ho_Chi_Minh', theme: 'light' })

        expect(view).toMatchObject({ theme: 'light', timezoneChangedAt: changed })
    })

    it('refuses a zone that another tab changed between the read and the write', async () => {
        const { repo, handler } = world()
        repo.beforeWrite = () => {
            repo.rows.set('user-1', { ...completed(), timezone: 'Europe/Paris', timezoneChangedAt: NOW })
            repo.beforeWrite = undefined
        }

        await expect(update(handler, { timezone: 'Asia/Tokyo' })).rejects.toBeInstanceOf(TimezoneChangeTooSoonError)
        expect(repo.rows.get('user-1')?.timezone).toBe('Europe/Paris')
    })

    it('stores a zone sent in another letter case as ICU spells it', async () => {
        const { handler } = world()

        await expect(update(handler, { timezone: 'asia/tokyo' })).resolves.toMatchObject({ timezone: 'Asia/Tokyo' })
    })

    it('answers USER_NOT_FOUND for an account that is gone', async () => {
        const { handler } = world(null)

        await expect(update(handler, { theme: 'dark' })).rejects.toBeInstanceOf(UserNotFoundError)
    })
})
