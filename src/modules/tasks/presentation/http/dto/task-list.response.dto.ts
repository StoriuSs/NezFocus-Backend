import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, ValidateNested } from 'class-validator'
import { TaskResponseDto } from './task.response.dto'

/**
 * A board's tasks (D-186). Without `status`: every task not done (at most
 * 500), by due date, none last, then the order they were made in, with
 * `done_count`. With `status=done`: up to 50 done tasks, the latest done
 * first, `has_more` saying whether there are older ones.
 */
export class TaskListResponseDto {
    @Expose()
    @ApiProperty({ type: [TaskResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => TaskResponseDto)
    items: TaskResponseDto[]

    /** The "XONG — n" heading; null on a page of done tasks. */
    @Expose()
    @ApiProperty({ type: Number, nullable: true })
    @IsOptional()
    @IsInt()
    doneCount: number | null

    @Expose()
    @IsBoolean()
    hasMore: boolean
}
