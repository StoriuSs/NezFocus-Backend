import { Inject } from '@nestjs/common'
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
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
import { UpdateSettingsCommand } from './update-settings.command'

/**
 * Save what the settings pages change (S-ME-04 → S-ME-06). Switches and
 * choices save as sent. The time zone changes at most once every 24 hours
 * (REQ-AUTH-08): sending the zone already in use is no change and starts no
 * clock; a change too soon is refused with when it may happen, and nothing
 * else sent with it is saved.
 */
@CommandHandler(UpdateSettingsCommand)
export class UpdateSettingsHandler implements ICommandHandler<UpdateSettingsCommand> {
    constructor(@Inject(USER_SETTINGS_REPOSITORY) private readonly settings: UserSettingsRepositoryPort) {}

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
        if (updated) return settingsView(updated, now)

        // Nothing matched: the zone changed too recently, or the account is gone.
        const latest = await this.settings.find(userId)
        const changeableAt = latest && timezoneChangeableAt(latest.timezoneChangedAt, now)
        if (changeableAt) throw new TimezoneChangeTooSoonError(changeableAt, now)
        throw new UserNotFoundError(userId)
    }
}
