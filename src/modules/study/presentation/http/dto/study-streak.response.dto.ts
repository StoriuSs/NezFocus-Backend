import { Expose } from 'class-transformer'
import { IsInt } from 'class-validator'

/** The streak (REQ-STUDY-07), kept up to date by `streak.updated`. */
export class StudyStreakResponseDto {
    /** The run to show today: 0 once a day was missed, until one qualifies again. */
    @Expose()
    @IsInt()
    current: number

    @Expose()
    @IsInt()
    longest: number
}
