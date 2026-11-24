import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsDate, IsIn, IsOptional } from 'class-validator'
import { SOLO_STATUSES, SoloStatus, STUDY_PHASES, StudyPhase } from '../../../domain'

/** Someone's Solo (D-247): paused, or waiting for "Học tiếp", has no end. */
export class SoloActivityResponseDto {
    @Expose()
    @ApiProperty({ enum: SOLO_STATUSES })
    @IsIn(SOLO_STATUSES)
    status: SoloStatus

    @Expose()
    @ApiProperty({ enum: STUDY_PHASES })
    @IsIn(STUDY_PHASES)
    phase: StudyPhase

    /** While running only: the client shows "còn N phút" from it. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    phaseEndsAt: Date | null
}
