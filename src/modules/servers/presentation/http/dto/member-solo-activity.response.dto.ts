import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsDate, IsIn, IsOptional } from 'class-validator'

/** A member's Solo (D-247): paused or waiting for "Học tiếp" has no end. */
export class MemberSoloActivityResponseDto {
    @Expose()
    @ApiProperty({ enum: ['running', 'paused', 'waiting'] })
    @IsIn(['running', 'paused', 'waiting'])
    status: 'running' | 'paused' | 'waiting'

    @Expose()
    @ApiProperty({ enum: ['focus', 'short_break', 'long_break'] })
    @IsIn(['focus', 'short_break', 'long_break'])
    phase: 'focus' | 'short_break' | 'long_break'

    /** While running only: the client shows "còn N phút" from it. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    phaseEndsAt: Date | null
}
