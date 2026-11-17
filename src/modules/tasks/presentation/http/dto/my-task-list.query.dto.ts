import { IsOptional, IsUUID } from 'class-validator'
import { TaskListQueryDto } from './task-list.query.dto'

/**
 * GET /me/tasks (SRS 5.1, D-186): as a board's list, over one's tasks from
 * every server, or from `server` only.
 */
export class MyTaskListQueryDto extends TaskListQueryDto {
    /** Only the tasks of this server; one is not in, or has no tasks of: none. */
    @IsOptional()
    @IsUUID()
    server?: string
}
