import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, ValidateNested } from 'class-validator'
import { ReadMessageResponseDto } from './read-message.response.dto'

/** A page of history, oldest first (SRS 5.1). */
export class MessagePageResponseDto {
    @Expose()
    @ApiProperty({ type: [ReadMessageResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => ReadMessageResponseDto)
    items: ReadMessageResponseDto[]

    /** Older messages exist: ask with `before` = the first id. */
    @Expose()
    @IsBoolean()
    hasMoreBefore: boolean

    /** Newer messages exist: ask with `after` = the last id. */
    @Expose()
    @IsBoolean()
    hasMoreAfter: boolean
}
