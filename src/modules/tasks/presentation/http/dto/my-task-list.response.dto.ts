import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, ValidateNested } from 'class-validator'
import { MyTaskResponseDto } from './my-task.response.dto'

/**
 * One's tasks (D-186). Without `status`: every task not done, by due date,
 * none last, then the order they were made in, with `done_count` and
 * `due_count`. With `status=done`: up to 50 done tasks, the latest done
 * first, `has_more` saying whether there are older ones.
 */
export class MyTaskListResponseDto {
    @Expose()
    @ApiProperty({ type: [MyTaskResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MyTaskResponseDto)
    items: MyTaskResponseDto[]

    /** The "ĐÃ XONG — n" heading; null on a page of done tasks. */
    @Expose()
    @ApiProperty({ type: Number, nullable: true })
    @IsOptional()
    @IsInt()
    doneCount: number | null

    /** The tasks overdue or due today: the rail's "Việc" badge (C-05); null on a page of done tasks. */
    @Expose()
    @ApiProperty({ type: Number, nullable: true })
    @IsOptional()
    @IsInt()
    dueCount: number | null

    @Expose()
    @IsBoolean()
    hasMore: boolean
}
