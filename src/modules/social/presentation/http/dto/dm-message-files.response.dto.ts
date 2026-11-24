import { Expose } from 'class-transformer'
import { IsInt } from 'class-validator'

/** The files of the last message: the row names them when it has no text. */
export class DmMessageFilesResponseDto {
    @Expose()
    @IsInt()
    count: number

    @Expose()
    @IsInt()
    images: number
}
