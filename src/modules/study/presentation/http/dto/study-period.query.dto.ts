import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsISO8601, IsOptional, Matches } from 'class-validator'

/**
 * GET /me/study-stats (SRS 5.1, D-105, D-229): a week (Monday to Sunday) or
 * a calendar month, named by any day in it.
 */
export class StudyPeriodQueryDto {
    /** `week` when left out. */
    @ApiPropertyOptional({ enum: ['week', 'month'] })
    @IsOptional()
    @IsIn(['week', 'month'])
    view?: 'week' | 'month'

    /** Any day of the period, YYYY-MM-DD, from 1900 to 2099; today in one's time zone when left out. */
    @ApiPropertyOptional({ example: '2026-10-05' })
    @IsOptional()
    @Matches(/^(19|20)\d{2}-\d{2}-\d{2}$/, { message: 'date must be a day as YYYY-MM-DD, from 1900 to 2099' })
    @IsISO8601({ strict: true })
    date?: string
}
