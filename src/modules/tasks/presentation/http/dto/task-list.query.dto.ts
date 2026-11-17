import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { TASK_TITLE_MAX_LENGTH } from '../../../domain'

/**
 * GET /channels/{id}/tasks (SRS 5.1, D-186). Without `status`: every task
 * not done, and how many are done. `status=done`: a page of done tasks, the
 * latest done first, after the task `before`.
 */
export class TaskListQueryDto {
    /** Only tasks whose title holds these words, whatever the accents and case (D-97). */
    @IsOptional()
    @IsString()
    @MaxLength(TASK_TITLE_MAX_LENGTH)
    q?: string

    @ApiPropertyOptional({ enum: ['done'] })
    @IsOptional()
    @IsIn(['done'])
    status?: 'done'

    /** With `status=done`: the last done task the client holds; left out, the first page. */
    @IsOptional()
    @IsUUID()
    before?: string
}
