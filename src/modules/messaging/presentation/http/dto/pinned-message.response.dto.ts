import { Expose } from 'class-transformer'
import { IsDate } from 'class-validator'
import { ReadMessageResponseDto } from './read-message.response.dto'

/** A pinned message, as the pins panel shows it (S-CHAT-02). */
export class PinnedMessageResponseDto extends ReadMessageResponseDto {
    @Expose()
    @IsDate()
    pinnedAt: Date
}
