import type { ChosenPresence } from '@/modules/users/domain/user-settings.rules'

/**
 * Domain Event: Presence Chosen
 *
 * Published when someone saves another status in their menu (REQ-AUTH-07,
 * D-78). The realtime module works out what others see of them and tells
 * their servers.
 */
export class PresenceChosenEvent {
    constructor(
        public readonly userId: string,
        public readonly presence: ChosenPresence
    ) {}
}
