/**
 * Domain Event: Avatar Removed
 *
 * Published when a user removes their avatar (D-72). Like AvatarUploaded, its
 * handler deletes the file that is no longer referenced.
 */
export class AvatarRemovedEvent {
    constructor(
        public readonly userId: string,
        public readonly previousAvatarUrl: string
    ) {}
}
