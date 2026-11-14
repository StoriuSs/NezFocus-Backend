import { Expose } from 'class-transformer'
import { IsInt } from 'class-validator'

/** The files of the message a reply answers: the reply line names them when it has no text. */
export class RepliedFilesResponseDto {
    @Expose()
    @IsInt()
    count: number

    @Expose()
    @IsInt()
    images: number
}
