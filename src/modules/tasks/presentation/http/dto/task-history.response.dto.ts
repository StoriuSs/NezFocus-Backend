import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsInt, ValidateNested } from 'class-validator'
import { TaskEventResponseDto } from './task-event.response.dto'

/** A task's history, newest first: the latest 200 lines, and how many it has. */
export class TaskHistoryResponseDto {
    @Expose()
    @ApiProperty({ type: [TaskEventResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => TaskEventResponseDto)
    items: TaskEventResponseDto[]

    @Expose()
    @IsInt()
    total: number
}
