import { ValidateIf } from 'class-validator'
import { LANGUAGES, THEMES } from '@/modules/users/domain/user-settings.rules'
import { OptionalChoiceField, OptionalSwitchField, TimeZoneField } from './settings.decorators'

/**
 * PATCH /users/me/settings (S-ME-04 → S-ME-06, SRS 7.1). Send only what
 * changed; each choice saves on its own (10-settings › Lưu thay đổi).
 *
 * The time zone changes at most once every 24 hours (REQ-AUTH-08): a change
 * too soon answers RATE_LIMIT_EXCEEDED with `data.reason = "timezone"` and
 * `data.changeable_at`, and saves nothing else sent with it. Sending the zone
 * already in use is no change.
 */
export class UpdateSettingsRequestDto {
    @ValidateIf((_dto: object, value: unknown) => value !== undefined)
    @TimeZoneField()
    timezone?: string

    @OptionalChoiceField(LANGUAGES)
    language?: (typeof LANGUAGES)[number]

    @OptionalChoiceField(THEMES)
    theme?: (typeof THEMES)[number]

    /** The sound when a study phase ends (REQ-STUDY-06). */
    @OptionalSwitchField()
    phaseSound?: boolean

    /** Browser notifications (REQ-NOTIF-04): the main switch, then one per kind. */
    @OptionalSwitchField()
    browserNotifications?: boolean

    @OptionalSwitchField()
    notifyMentions?: boolean

    @OptionalSwitchField()
    notifyDirectMessages?: boolean

    @OptionalSwitchField()
    notifyIncomingCalls?: boolean

    @OptionalSwitchField()
    notifyPhaseChanges?: boolean

    /** "Not now" on the prompt to turn browser notifications on (D-100). */
    @OptionalSwitchField()
    notificationPromptDismissed?: boolean

    /** Direct messages from people who share a server (REQ-SOCIAL-04). */
    @OptionalSwitchField()
    allowServerMemberMessages?: boolean

    /** "Show study activity" (D-79). */
    @OptionalSwitchField()
    showStudyActivity?: boolean
}
