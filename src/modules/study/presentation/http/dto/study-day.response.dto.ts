import { Expose } from 'class-transformer'
import { IsInt, IsString } from 'class-validator'

/** One day of a period (D-104): focused = room + solo, in seconds. */
export class StudyDayResponseDto {
    /** YYYY-MM-DD. */
    @Expose()
    @IsString()
    date: string

    @Expose()
    @IsInt()
    focusedSeconds: number

    @Expose()
    @IsInt()
    roomSeconds: number

    @Expose()
    @IsInt()
    soloSeconds: number
}
