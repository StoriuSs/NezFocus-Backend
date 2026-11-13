import { IsString, Length } from 'class-validator'
import { MessageContentField } from './message-content.decorators'

/** POST /channels/{id}/messages (REQ-MSG-01). */
export class SendMessageRequestDto {
    /** 1-2000 characters, an emoji counting as one, once the blank around it is dropped. */
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
}
