/** New read links for a file whose links ended (SRS 5.1 `GET /attachments/{id}/url`). */
export class GetAttachmentLinksQuery {
    constructor(
        readonly userId: string,
        readonly attachmentId: string
    ) {}
}
