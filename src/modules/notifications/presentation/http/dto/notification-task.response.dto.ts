import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString } from 'class-validator'
import { TaskReminder, UnassignedBy } from '../../../domain'

const REMINDERS: TaskReminder[] = ['24h', '2h']
const UNASSIGNED_BY: UnassignedBy[] = ['withdrew', 'left_server']

/**
 * The task of a task item as it was when the item was made (D-98): opening
 * the item shows the task as it is now (`GET /tasks/{id}`).
 */
export class NotificationTaskResponseDto {
    @Expose()
    @IsString()
    title: string

    /** The due date then; null when it had none. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    dueAt: Date | null

    /** `task_reminder`: 24 hours or 2 hours before it is due (REQ-TASK-04); null on the other kinds. */
    @Expose()
    @ApiProperty({ enum: REMINDERS, nullable: true })
    @IsOptional()
    @IsIn(REMINDERS)
    reminder: TaskReminder | null

    /**
     * `task_unassigned`: its last person took themselves off, or left the
     * server (D-95); `actor` is who. Null on the other kinds.
     */
    @Expose()
    @ApiProperty({ enum: UNASSIGNED_BY, nullable: true })
    @IsOptional()
    @IsIn(UNASSIGNED_BY)
    unassignedBy: UnassignedBy | null
}
