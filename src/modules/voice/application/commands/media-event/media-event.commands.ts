/** A webhook of the media server (D-210), as it came: checked, then taken once. */
export class ApplyMediaEventCommand {
    constructor(
        /** The body exactly as sent: its sha256 is what the signature covers. */
        public readonly body: string,
        public readonly authorization: string | undefined
    ) {}
}
