/**
 * Domain Event: User Profile Updated
 *
 * Published when any user profile data changes (update profile, set username, upload avatar, etc.)
 * Event handlers react to this for cache invalidation.
 */
export class UserProfileUpdatedEvent {
    constructor(public readonly userId: string) {}
}
