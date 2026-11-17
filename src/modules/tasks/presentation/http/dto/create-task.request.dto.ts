import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator'
import { MAX_ASSIGNEES_A_REQUEST } from './shared/fields'
import { DueAtField } from './task-due.decorators'
import { TaskDescriptionField, TaskTitleField } from './task-text.decorators'

/** POST /channels/{id}/tasks (S-TASK-03). */
export class CreateTaskRequestDto {
    @TaskTitleField(true)
    title: string

    /** Null or left out: none. */
    @IsOptional()
    @TaskDescriptionField()
    description?: string | null

    /** Later than now; null or left out: no due date. */
    @DueAtField()
    dueAt?: string | null

    /** Members who view the channel; none: "Chưa giao". */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_ASSIGNEES_A_REQUEST)
    @IsUUID('all', { each: true })
    assigneeIds?: string[] | null
}
