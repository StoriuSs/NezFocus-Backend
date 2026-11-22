import { Expose, Type } from 'class-transformer'
import { IsArray, IsBoolean, ValidateNested } from 'class-validator'
import { StudySessionLineResponseDto } from './study-session-line.response.dto'

/**
 * GET /me/study-sessions (D-105, D-229, D-230): the session one is in first,
 * on the first page; then the latest first join first, 20 a page. The next
 * page is asked with the last line's `session_id` as `cursor`; one left
 * between two pages may come again, kept once by its id.
 */
export class StudySessionPageResponseDto {
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StudySessionLineResponseDto)
    items: StudySessionLineResponseDto[]

    @Expose()
    @IsBoolean()
    hasMore: boolean
}
