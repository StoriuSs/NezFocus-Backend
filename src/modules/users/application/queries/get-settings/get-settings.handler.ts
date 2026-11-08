import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import {
    settingsView,
    SettingsView,
    USER_SETTINGS_REPOSITORY,
    UserNotFoundError,
    UserSettingsRepositoryPort
} from '@/modules/users/domain'
import { GetSettingsQuery } from './get-settings.query'

/**
 * The settings another browser applies once signed in (REQ-AUTH-08), with
 * when the zone may change again, worked out here so client clocks don't matter.
 */
@QueryHandler(GetSettingsQuery)
export class GetSettingsHandler implements IQueryHandler<GetSettingsQuery> {
    constructor(@Inject(USER_SETTINGS_REPOSITORY) private readonly settings: UserSettingsRepositoryPort) {}

    async execute({ userId }: GetSettingsQuery): Promise<SettingsView> {
        const found = await this.settings.find(userId)
        if (!found) throw new UserNotFoundError(userId)
        return settingsView(found, new Date())
    }
}
