import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator'
import { MentionedRoleResponseDto } from './mentioned-role.response.dto'
import { MentionedUserResponseDto } from './mentioned-user.response.dto'
import { MessageAuthorResponseDto } from './message-author.response.dto'

/** The message a reply answers, as its reply line shows it (C-10 `reply`). */
export class RepliedMessageResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Null once that message is deleted. */
    @Expose()
    @ApiProperty({ type: MessageAuthorResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => MessageAuthorResponseDto)
    author: MessageAuthorResponseDto | null

    /** Its text as it is now (edits show); empty once deleted. */
    @Expose()
    @IsString()
    content: string

    /** The reply line says "the original message was deleted" (REQ-MSG-05). */
    @Expose()
    @IsBoolean()
    deleted: boolean

    /** The people its <@id> tokens name, as on a message (D-171); empty once deleted. */
    @Expose()
    @ApiProperty({ type: [MentionedUserResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MentionedUserResponseDto)
    mentionUsers: MentionedUserResponseDto[]

    /** The roles it mentions in effect, as named now (D-171); empty once deleted. */
    @Expose()
    @ApiProperty({ type: [MentionedRoleResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MentionedRoleResponseDto)
    mentionRoles: MentionedRoleResponseDto[]
}
