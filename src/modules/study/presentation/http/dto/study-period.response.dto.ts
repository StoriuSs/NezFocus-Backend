import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

/** The days a period runs, both in, YYYY-MM-DD. */
export class StudyPeriodResponseDto {
    @Expose()
    @IsString()
    start: string

    @Expose()
    @IsString()
    end: string
}
