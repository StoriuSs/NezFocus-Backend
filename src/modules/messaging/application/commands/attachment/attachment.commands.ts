/** Ask for a form to upload one file for a message in a channel (REQ-MSG-04, D-165). */
export class RequestUploadCommand {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        /** As the browser named it: the type is read from its extension, then from the content. */
        readonly filename: string,
        /** In bytes, as the browser says; the storage keeps it to 25 MB whatever is said. */
        readonly size: number
    ) {}
}

/** The upload is done: check what reached the storage before it can be sent (D-93). */
export class CompleteUploadCommand {
    constructor(
        readonly userId: string,
        readonly attachmentId: string
    ) {}
}

/** Remove the files no message holds: never sent within 24 hours, or let go by a deleted message. */
export class CleanUpAttachmentsCommand {
    constructor(readonly now: Date) {}
}
