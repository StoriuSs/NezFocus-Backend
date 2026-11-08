/**
 * A person's settings (SRS 7.1, REQ-AUTH-08, D-131): the same in every
 * browser they sign in to. Some switches only take effect in later
 * milestones; they are stored now so the settings pages are whole.
 */

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

/** The languages of the interface and of the emails nobody asked for (D-64, D-132). */
export const LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export interface UserSettings {
    /** An IANA zone name (timezone.rules.ts): where a study day starts and ends. */
    timezone: string
    /** When the zone was last changed in the settings; null if never (the pick when completing does not count, D-61). */
    timezoneChangedAt: Date | null
    language: Language
    theme: Theme
    /** The sound when a study phase ends (REQ-STUDY-06, D-140). */
    phaseSound: boolean
    /** Browser notifications: the main switch, then one per kind (REQ-NOTIF-04; the page comes in M7). */
    browserNotifications: boolean
    notifyMentions: boolean
    notifyDirectMessages: boolean
    notifyIncomingCalls: boolean
    notifyPhaseChanges: boolean
    /** "Not now" on the prompt to turn them on (D-100). */
    notificationPromptDismissed: boolean
    /** Direct messages from people who share a server (REQ-SOCIAL-04). */
    allowServerMemberMessages: boolean
    /** "Show study activity" (D-79). */
    showStudyActivity: boolean
}

/** The settings, and when the zone may change again: null if it may now. */
export interface SettingsView extends UserSettings {
    timezoneChangeableAt: Date | null
}

/** The time zone changes at most once every 24 hours: it moves the study day, and with it streaks (D-22). */
export const TIMEZONE_CHANGE_INTERVAL_MS = 24 * 60 * 60 * 1000

/** When a zone last changed at `changedAt` may change again, or null if it may at `now`. */
export function timezoneChangeableAt(changedAt: Date | null, now: Date): Date | null {
    if (!changedAt) return null
    const next = new Date(changedAt.getTime() + TIMEZONE_CHANGE_INTERVAL_MS)
    return next > now ? next : null
}

export const settingsView = (settings: UserSettings, now: Date): SettingsView => ({
    ...settings,
    timezoneChangeableAt: timezoneChangeableAt(settings.timezoneChangedAt, now)
})
