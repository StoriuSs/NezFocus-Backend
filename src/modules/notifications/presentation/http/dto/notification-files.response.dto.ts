import { Expose } from 'class-transformer'
import { IsInt } from 'class-validator'

/** The message's files: an item names them when the message has no text (spec 06 › Chữ). */
export class NotificationFilesResponseDto {
    @Expose()
    @IsInt()
    count: number

    @Expose()
    @IsInt()
    images: number
}
