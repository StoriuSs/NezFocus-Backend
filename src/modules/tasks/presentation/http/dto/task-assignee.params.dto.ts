import { IsUUID } from 'class-validator'

/** DELETE /tasks/{id}/assignees/{user_id}. */
export class TaskAssigneeParamsDto {
    @IsUUID()
    taskId: string

    @IsUUID()
    userId: string
}
