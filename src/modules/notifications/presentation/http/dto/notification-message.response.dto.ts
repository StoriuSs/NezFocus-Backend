import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsString, ValidateNested } from 'class-validator'
import { NotificationFilesResponseDto } from './notification-files.response.dto'
import { NotificationMentionedRoleResponseDto } from './notification-mentioned-role.response.dto'
import { NotificationMentionedUserResponseDto } from './notification-mentioned-user.response.dto'

/**
 * The message a mention or reply item is about, as it is now (spec 06 ›
 * Luật hộp thư): its text as written (markdown, mention tokens), which the
 * client shows plain, with the names its tokens stand for.
 */
export class NotificationMessageResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    content: string

    @Expose()
    @ApiProperty({ type: [NotificationMentionedUserResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => NotificationMentionedUserResponseDto)
    mentionUsers: NotificationMentionedUserResponseDto[]

    @Expose()
    @ApiProperty({ type: [NotificationMentionedRoleResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => NotificationMentionedRoleResponseDto)
    mentionRoles: NotificationMentionedRoleResponseDto[]

    @Expose()
    @ValidateNested()
    @Type(() => NotificationFilesResponseDto)
    files: NotificationFilesResponseDto
}
