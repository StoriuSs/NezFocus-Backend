import { Inject } from '@nestjs/common'
import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import {
    canonicalTimeZone,
    settingsView,
    SettingsView,
    TIMEZONE_CHANGE_INTERVAL_MS,
    timezoneChangeableAt,
    TimezoneChangeTooSoonError,
    USER_SETTINGS_REPOSITORY,
    UserNotFoundError,
    UserSettingsRepositoryPort
} from '@/modules/users/domain'
import { PresenceChosenEvent } from '../../events/presence-chosen.event'
import { StudyActivitySwitchedEvent } from '../../events/study-activity-switched.event'
import { UpdateSettingsCommand } from './update-settings.command'

/**
 * Save what the settings pages change (S-ME-04 → S-ME-06). Switches and
 * choices save as sent. The time zone changes at most once every 24 hours
 * (REQ-AUTH-08): sending the zone already in use is no change and starts no
 * clock; a change too soon is refused with when it may happen, and nothing
 * else sent with it is saved. A status chosen in the menu is told to the
 * other modules once saved: the realtime module shows it to others
 * (REQ-AUTH-07), and tells nothing when what they see is the same. So is
 * "Show study activity": the social module tells the activity line again
 * (D-247).
 */
@CommandHandler(UpdateSettingsCommand)
export class UpdateSettingsHandler implements ICommandHandler<UpdateSettingsCommand> {
    constructor(
        @Inject(USER_SETTINGS_REPOSITORY) private readonly settings: UserSettingsRepositoryPort,
        private readonly eventBus: EventBus
    ) {}

    async execute({ userId, changes }: UpdateSettingsCommand): Promise<SettingsView> {
        const now = new Date()
        const { timezone: sent, ...rest } = changes
        const current = await this.settings.find(userId)
        if (!current) throw new UserNotFoundError(userId)

        // The DTO has checked it is a zone; this only fixes its letter case.
        const zone = sent === undefined ? undefined : (canonicalTimeZone(sent) ?? sent)
        const change =
            zone !== undefined && zone !== current.timezone
                ? { timezone: zone, at: now, lastChangeBefore: new Date(now.getTime() - TIMEZONE_CHANGE_INTERVAL_MS) }
                : undefined

        // The 24 hours are checked by the write itself, so two tabs at once cannot both change the zone.
        const updated = await this.settings.update(userId, rest, change)
        if (updated) {
            // Each time it is sent, unchanged or not: of two tabs choosing at once, the last told is the last saved.
            if (rest.presence !== undefined) {
                this.eventBus.publish(new PresenceChosenEvent(userId, updated.presence))
            }
            if (rest.showStudyActivity !== undefined) {
                this.eventBus.publish(new StudyActivitySwitchedEvent(userId, updated.showStudyActivity))
            }
            return settingsView(updated, now)
        }

        // Nothing matched: the zone changed too recently, or the account is gone.
        const latest = await this.settings.find(userId)
        const changeableAt = latest && timezoneChangeableAt(latest.timezoneChangedAt, now)
        if (changeableAt) throw new TimezoneChangeTooSoonError(changeableAt, now)
        throw new UserNotFoundError(userId)
    }
}
