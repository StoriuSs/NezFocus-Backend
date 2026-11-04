/**
 * Domain Event: Avatar Uploaded
 *
 * Published when a new avatar is uploaded and the user had a previous avatar.
 * Event handlers react to this for old avatar cleanup.
 */
export class AvatarUploadedEvent {
    constructor(
        public readonly userId: string,
        public readonly previousAvatarUrl: string
    ) {}
}
