import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { TASK_STATUSES, TaskStatus } from '../../../domain'
import { TaskAssigneeResponseDto } from './task-assignee.response.dto'
import { TaskPersonResponseDto } from './task-person.response.dto'

/** One task, as the board, `GET /tasks/{id}`, every write and `task.created` / `task.updated` give it (D-191). */
export class TaskResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    serverId: string

    @Expose()
    @IsString()
    channelId: string

    @Expose()
    @IsString()
    title: string

    /** Empty: none. */
    @Expose()
    @IsString()
    description: string

    @Expose()
    @ApiProperty({ enum: TASK_STATUSES })
    @IsIn([...TASK_STATUSES])
    status: TaskStatus

    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    dueAt: Date | null

    /** When it became done; null while it is not (ARCHITECTURE 7). */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    completedAt: Date | null

    @Expose()
    @IsDate()
    createdAt: Date

    /** Moves on every change: of two copies of a task, the client keeps the later one. */
    @Expose()
    @IsDate()
    updatedAt: Date

    @Expose()
    @ValidateNested()
    @Type(() => TaskPersonResponseDto)
    creator: TaskPersonResponseDto

    /** In the order they were given the task; none: "Chưa giao". */
    @Expose()
    @ApiProperty({ type: [TaskAssigneeResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => TaskAssigneeResponseDto)
    assignees: TaskAssigneeResponseDto[]
}
