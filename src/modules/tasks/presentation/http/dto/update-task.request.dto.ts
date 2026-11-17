import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, ValidateIf } from 'class-validator'
import { TASK_STATUSES, TaskStatus } from '../../../domain'
import { DueAtField } from './task-due.decorators'
import { TaskDescriptionField, TaskTitleField } from './task-text.decorators'

/** Left out passes; null is checked like any value, and none of these may be null. */
const unlessLeftOut = () => ValidateIf((_, value) => value !== undefined)

/**
 * PATCH /tasks/{id} ("Sửa việc", the status control): only what is sent
 * changes, and only what really changes needs its right (REQ-TASK-02).
 */
export class UpdateTaskRequestDto {
    @unlessLeftOut()
    @TaskTitleField(false)
    title?: string

    @unlessLeftOut()
    @TaskDescriptionField()
    description?: string

    /** A new one must be later than now (D-96). Null: no due date. */
    @DueAtField()
    dueAt?: string | null

    @ApiPropertyOptional({ enum: TASK_STATUSES })
    @unlessLeftOut()
    @IsIn([...TASK_STATUSES])
    status?: TaskStatus
}
