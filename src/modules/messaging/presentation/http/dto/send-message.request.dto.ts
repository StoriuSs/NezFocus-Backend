import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator'
import { MessageContentField } from './message-content.decorators'

/** POST /channels/{id}/messages (REQ-MSG-01, REQ-MSG-05). */
export class SendMessageRequestDto {
    /** At most 2000 characters, an emoji counting as one, once the blank around it is dropped; empty only with files. */
    @MessageContentField()
    content: string

    /**
     * Chosen by the client for this message and kept across its retries: the
     * same nonce again answers with the message already sent (REQ-MSG-10),
     * and `message.created` carries it back so the sender's "sending" copy
     * is swapped for the saved one.
     */
    @IsString()
    @Length(1, 64)
    nonce: string

    /** The message this one answers: a regular message of the same channel, deleted or not (REQ-MSG-05). */
    @IsOptional()
    @IsUUID()
    replyToId?: string

    /**
     * Checked uploads of the sender's (`POST /attachments/{id}/complete`), in
     * the order they show: at most 10, each once (REQ-MSG-04). One that cannot
     * be sent (not checked, sent already, older than 24 hours) is named in
     * UPLOAD_FILE_NOT_FOUND's `attachment_ids`.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsUUID('all', { each: true })
    attachmentIds?: string[]
}
