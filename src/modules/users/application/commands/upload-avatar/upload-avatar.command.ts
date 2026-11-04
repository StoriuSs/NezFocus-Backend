/**
 * UploadAvatarCommand
 *
 * Command to upload and set a user's avatar image.
 */
export class UploadAvatarCommand {
    constructor(
        public readonly userId: string,
        public readonly fileBuffer: Buffer,
        public readonly originalName: string
    ) {}
}
