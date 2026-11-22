import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsArray, IsDate, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator'
import { StudyDayResponseDto } from './study-day.response.dto'
import { StudyGridDayResponseDto } from './study-grid-day.response.dto'
import { StudyPeriodResponseDto } from './study-period.response.dto'
import { StudyStreakResponseDto } from './study-streak.response.dto'

/**
 * GET /me/study-stats (REQ-STUDY-07, D-104, D-105, D-230): every number of
 * the Stats page and of the Study page's streak block, in seconds. The
 * client adds the focus time running after the last count (D-224).
 */
export class StudyStatsResponseDto {
    @Expose()
    @IsIn(['week', 'month'])
    view: 'week' | 'month'

    /** Today in one's time zone (YYYY-MM-DD): the days after it are still ahead. */
    @Expose()
    @IsString()
    today: string

    @Expose()
    @ValidateNested()
    @Type(() => StudyPeriodResponseDto)
    period: StudyPeriodResponseDto

    /** Every day of the period, in order, those still ahead included (0). */
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StudyDayResponseDto)
    days: StudyDayResponseDto[]

    @Expose()
    @IsInt()
    totalSeconds: number

    @Expose()
    @IsInt()
    roomSeconds: number

    @Expose()
    @IsInt()
    soloSeconds: number

    /**
     * The period before, over as many first days as this one has gone by
     * (all of it once this one is over). Null, no comparison shown: nothing
     * counted before this period, or a period still ahead.
     */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    previousSeconds: number | null

    /** All of the period before, null when previous_seconds is: 0 says "Tuần trước chưa học" (D-230). */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    previousPeriodSeconds: number | null

    /** The mean a day over the days gone by, today in, rounded down. */
    @Expose()
    @IsInt()
    averageSeconds: number

    @Expose()
    @IsInt()
    allTimeSeconds: number

    /** The first day with a second counted ("‹" stops at its period); null: never studied (the empty page). */
    @ApiProperty({ type: String, nullable: true })
    @Expose()
    @IsOptional()
    @IsString()
    firstDate: string | null

    @Expose()
    @ValidateNested()
    @Type(() => StudyStreakResponseDto)
    streak: StudyStreakResponseDto

    @Expose()
    @IsInt()
    todaySeconds: number

    /**
     * Where the count of the session one is in stands (room or Solo), null
     * when in none: the client adds the focus running after it to
     * today_seconds (D-224, D-231).
     */
    @ApiProperty({ type: Date, nullable: true })
    @Expose()
    @IsOptional()
    @IsDate()
    countedUntil: Date | null

    /**
     * When today_seconds and counted_until were read: of this and the
     * `streak.updated` heard, the client keeps the later (D-232).
     */
    @ApiProperty({ type: Date })
    @Expose()
    @IsDate()
    readAt: Date

    /** A week's 4-week grid, the 28 days up to its Sunday; null for a month. */
    @ApiProperty({ type: [StudyGridDayResponseDto], nullable: true })
    @Expose()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StudyGridDayResponseDto)
    grid: StudyGridDayResponseDto[] | null

    /**
     * The greatest total of any other week: the week shown is the best one
     * when its own is greater (D-230). Null for a month, and for the first
     * week with seconds or one before it.
     */
    @ApiProperty({ type: Number, nullable: true })
    @Expose()
    @IsOptional()
    @IsInt()
    bestOtherWeekSeconds: number | null
}
