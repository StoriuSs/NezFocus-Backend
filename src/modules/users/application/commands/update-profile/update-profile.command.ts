/**
 * UpdateProfileCommand
 *
 * Command to update a user's profile fields (displayName, bio, etc.)
 */
export class UpdateProfileCommand {
    constructor(
        public readonly userId: string,
        public readonly displayName?: string,
        public readonly bio?: string
    ) {}
}
