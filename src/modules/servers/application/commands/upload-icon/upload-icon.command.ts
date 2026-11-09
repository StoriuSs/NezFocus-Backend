export class UploadServerIconCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly file: Buffer
    ) {}
}
