import type { UserSettings } from '../user-settings.rules'

/** The settings that change freely: every one but the time zone. */
export type SettingsChanges = Partial<Omit<UserSettings, 'timezone' | 'timezoneChangedAt'>>

/** A time zone change: the zone, when, and the latest earlier change that still allows it. */
export interface TimezoneChange {
    timezone: string
    at: Date
    /** The zone may change if it never changed in the settings, or last changed at or before this. */
    lastChangeBefore: Date
}

/**
 * Where a person's settings are kept (SRS 7.1). The row is made when the
 * account is completed (UserRepositoryPort.complete); until then there are
 * none, and the API refuses the account anyway (ACCOUNT_INCOMPLETE).
 */
export interface UserSettingsRepositoryPort {
    /** A live user's settings; null if the user is gone or has none. */
    find(userId: string): Promise<UserSettings | null>

    /**
     * Apply `changes`, and `timezone` if given. The zone's rule is checked in
     * the statement that writes, not by an earlier read: two tabs changing
     * the zone at once, one of them wins. When the zone is refused nothing
     * is written, the other changes included.
     *
     * @returns the settings after the write; null if no row matched — the
     *   user is gone, or the zone changed too recently
     */
    update(userId: string, changes: SettingsChanges, timezone?: TimezoneChange): Promise<UserSettings | null>
}

export const USER_SETTINGS_REPOSITORY = Symbol('UserSettingsRepositoryPort')
