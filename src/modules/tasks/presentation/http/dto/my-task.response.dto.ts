import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsIn, IsOptional } from 'class-validator'
import { DUE_GROUPS, DueGroup } from '../../../domain'
import { TaskResponseDto } from './task.response.dto'

/** A task on the To-do page (S-TASK-04): the task, and its group by due date. */
export class MyTaskResponseDto extends TaskResponseDto {
    /**
     * Overdue, today, the next 7 days (tomorrow to today + 6), later, no due
     * date: counted in the time zone of one's settings when the list was read
     * (D-186). Null on a page of done tasks.
     */
    @Expose()
    @ApiProperty({ enum: DUE_GROUPS, nullable: true })
    @IsOptional()
    @IsIn([...DUE_GROUPS])
    group: DueGroup | null
}
