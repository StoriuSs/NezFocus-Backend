import { MessageContentField } from './message-content.decorators'

/** PATCH /messages/{id} (REQ-MSG-05): the new text, under the same rules as a new message's. */
export class EditMessageRequestDto {
    /** 1-2000 characters, an emoji counting as one, once the blank around it is dropped. */
    @MessageContentField()
    content: string
}
