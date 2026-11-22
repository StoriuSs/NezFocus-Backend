import { IsOptional, IsUUID } from 'class-validator'
import { StudyPeriodQueryDto } from './study-period.query.dto'

/**
 * GET /me/study-sessions (SRS 5.1, D-229, D-230): the period as for the
 * stats, and where the page starts.
 */
export class StudySessionsQueryDto extends StudyPeriodQueryDto {
    /** The session of the last line the client holds; left out, the first page. Not one of one's sessions: CONFLICT_ERROR. */
    @IsOptional()
    @IsUUID()
    cursor?: string
}
