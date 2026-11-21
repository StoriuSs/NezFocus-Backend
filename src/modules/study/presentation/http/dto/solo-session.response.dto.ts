import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsOptional, ValidateNested } from 'class-validator'
import { FocusSessionResponseDto } from './focus-session.response.dto'
import { StudyCycleResponseDto } from './study-cycle.response.dto'

/** GET /me/solo-session (REQ-STUDY-05, D-229). */
export class SoloSessionResponseDto {
    /** One's Solo not yet ended, kept up to date by `solo_session.updated`; null when none. */
    @ApiProperty({ type: FocusSessionResponseDto, nullable: true })
    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => FocusSessionResponseDto)
    session: FocusSessionResponseDto | null

    /**
     * The cycle POST /me/solo-session starts with when sent none ("Bắt đầu
     * Tập trung 50 phút"): the last Solo's, or 25/5 for a first one (D-103).
     */
    @Expose()
    @ValidateNested()
    @Type(() => StudyCycleResponseDto)
    startCycle: StudyCycleResponseDto
}
