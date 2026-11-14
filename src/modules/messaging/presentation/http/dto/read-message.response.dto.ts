import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { MessageResponseDto } from './message.response.dto'
import { ReactionSummaryResponseDto } from './reaction-summary.response.dto'

/**
 * A message as one person reads it in history and the pins: with its
 * reactions, in the order each emoji was first given. Events and the send and
 * edit answers do not carry them (`reaction.added` / `reaction.removed` do).
 */
export class ReadMessageResponseDto extends MessageResponseDto {
    @Expose()
    @ApiProperty({ type: [ReactionSummaryResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => ReactionSummaryResponseDto)
    reactions: ReactionSummaryResponseDto[]
}
