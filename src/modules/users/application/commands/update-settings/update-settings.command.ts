import type { SettingsChanges } from '@/modules/users/domain'

/** PATCH /users/me/settings: any of the settings, the time zone included. */
export class UpdateSettingsCommand {
    constructor(
        public readonly userId: string,
        public readonly changes: SettingsChanges & { timezone?: string }
    ) {}
}
