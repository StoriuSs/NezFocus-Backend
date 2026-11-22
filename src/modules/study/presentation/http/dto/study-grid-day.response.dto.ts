import { Expose } from 'class-transformer'
import { IsInt, IsString } from 'class-validator'

/** One square of the 4-week grid (C-46): reached 15 minutes or not. */
export class StudyGridDayResponseDto {
    /** YYYY-MM-DD. */
    @Expose()
    @IsString()
    date: string

    @Expose()
    @IsInt()
    focusedSeconds: number
}
