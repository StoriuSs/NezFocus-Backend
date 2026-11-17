import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { TASK_EVENT_KINDS, TaskEventKind } from '../../../domain'
import { TaskPersonResponseDto } from './task-person.response.dto'

/**
 * One line of a task's history (REQ-TASK-03, S-TASK-02 › Lịch sử). An
 * `assignee_added` whose subject is its actor is "đã tự nhận việc", an
 * `assignee_removed` one "đã rút khỏi việc".
 */
export class TaskEventResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @ApiProperty({ enum: TASK_EVENT_KINDS })
    @IsIn([...TASK_EVENT_KINDS])
    kind: TaskEventKind

    /** Null when the app did it (an assignee who left the server). */
    @Expose()
    @ApiProperty({ type: TaskPersonResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => TaskPersonResponseDto)
    actor: TaskPersonResponseDto | null

    /** The person added or taken off; null for the other kinds. */
    @Expose()
    @ApiProperty({ type: TaskPersonResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => TaskPersonResponseDto)
    subject: TaskPersonResponseDto | null

    /** Title, due date (an ISO time, null: none) or status before the change; null for the other kinds. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    from: string | null

    /** The same after the change. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    to: string | null

    @Expose()
    @IsDate()
    createdAt: Date
}
