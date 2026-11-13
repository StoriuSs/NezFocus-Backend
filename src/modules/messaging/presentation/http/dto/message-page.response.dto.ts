import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, ValidateNested } from 'class-validator'
import { MessageResponseDto } from './message.response.dto'

/** A page of history, oldest first (SRS 5.1). */
export class MessagePageResponseDto {
    @Expose()
    @ApiProperty({ type: [MessageResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MessageResponseDto)
    items: MessageResponseDto[]

    /** Older messages exist: ask with `before` = the first id. */
    @Expose()
    @IsBoolean()
    hasMoreBefore: boolean

    /** Newer messages exist: ask with `after` = the last id. */
    @Expose()
    @IsBoolean()
    hasMoreAfter: boolean
}
