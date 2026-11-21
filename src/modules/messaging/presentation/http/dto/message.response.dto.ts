import { ApiProperty } from '@nestjs/swagger'
import { Expose, Transform, Type } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import { AttachmentResponseDto } from './attachment.response.dto'
import { MentionedRoleResponseDto } from './mentioned-role.response.dto'
import { MentionedUserResponseDto } from './mentioned-user.response.dto'
import { MessageAuthorResponseDto } from './message-author.response.dto'
import { RepliedMessageResponseDto } from './replied-message.response.dto'

/** One message, as history pages, the send and edit routes, `message.created` and `message.updated` give it. */
export class MessageResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    channelId: string

    /** `system`: made by the app (REQ-MSG-08), with no author. */
    @Expose()
    @ApiProperty({ enum: ['regular', 'system'] })
    @IsIn(['regular', 'system'])
    type: 'regular' | 'system'

    /** Null on a system message (D-168). */
    @Expose()
    @ApiProperty({ type: MessageAuthorResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => MessageAuthorResponseDto)
    author: MessageAuthorResponseDto | null

    /**
     * Plain text; empty on a system message. Mentions are tokens: <@id> a
     * person, <@&id> a role, <#id> a channel, and @everyone (REQ-MSG-03).
     */
    @Expose()
    @IsString()
    content: string

    /** @everyone in effect: the author had MENTION_EVERYONE. Otherwise the words are only words. */
    @Expose()
    @IsBoolean()
    mentionEveryone: boolean

    /** Whom @here reached as it was sent (D-166): those not offline who saw the channel. The client marks it for them. */
    @Expose()
    @ApiProperty({ type: [String] })
    @IsString({ each: true })
    mentionHereUserIds: string[]

    /** The people its <@id> tokens name, as they are now (D-171); an id of no account is left out. */
    @Expose()
    @ApiProperty({ type: [MentionedUserResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MentionedUserResponseDto)
    mentionUsers: MentionedUserResponseDto[]

    /** The roles it mentions in effect, as named now; a role deleted since is left out (D-171). */
    @Expose()
    @ApiProperty({ type: [MentionedRoleResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MentionedRoleResponseDto)
    mentionRoles: MentionedRoleResponseDto[]

    /**
     * What a system message reports (`member_joined`, `message_pinned`, `task_due`,
     * `study_session_started`, `study_session_ended`); null on a regular one.
     */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    systemEvent: string | null

    /**
     * Whom a system message is about (`{ user_id }`, `{ user_id, message_id }`,
     * D-168); a task's reminder: `{ task_id, title, reminder, due_at, user_ids }`,
     * its title when sent; a study session: `{ user_id, session_id, focus_minutes,
     * short_break_minutes }` started, `{ session_id, reason }` ended. Null on a
     * regular one.
     */
    @Expose()
    // As it is: an untyped object would otherwise come out empty, every key not @Expose()d.
    @Transform(({ obj }: { obj: { systemData?: unknown } }) => obj.systemData ?? null, { toClassOnly: true })
    @ApiProperty({ type: Object, nullable: true })
    @IsOptional()
    @IsObject()
    systemData: Record<string, unknown> | null

    /** That person, named and pictured like an author; null on a regular message, or one naming no one. */
    @Expose()
    @ApiProperty({ type: MessageAuthorResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => MessageAuthorResponseDto)
    systemUser: MessageAuthorResponseDto | null

    /** The people a task's reminder is for, in order, named like authors (D-95, D-182); empty on any other message. */
    @Expose()
    @ApiProperty({ type: [MessageAuthorResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MessageAuthorResponseDto)
    systemUsers: MessageAuthorResponseDto[]

    /** The message this one answers; null if none (REQ-MSG-05). */
    @Expose()
    @ApiProperty({ type: RepliedMessageResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => RepliedMessageResponseDto)
    replyTo: RepliedMessageResponseDto | null

    /** Shown as "edited"; null if never edited. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    editedAt: Date | null

    /** In the channel's pins (REQ-MSG-07). */
    @Expose()
    @IsBoolean()
    pinned: boolean

    /** Its files, in the order sent (REQ-MSG-04): images first is the client's to draw (C-10). */
    @Expose()
    @ApiProperty({ type: [AttachmentResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => AttachmentResponseDto)
    attachments: AttachmentResponseDto[]

    @Expose()
    @IsDate()
    createdAt: Date
}
