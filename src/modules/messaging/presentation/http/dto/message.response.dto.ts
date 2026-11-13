import { ApiProperty } from '@nestjs/swagger'
import { Expose, Transform, Type } from 'class-transformer'
import { IsDate, IsIn, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
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

    /** Plain text; empty on a system message. */
    @Expose()
    @IsString()
    content: string

    /** What a system message reports (`member_joined`, `message_pinned`); null on a regular one. */
    @Expose()
    @ApiProperty({ type: String, nullable: true })
    @IsOptional()
    @IsString()
    systemEvent: string | null

    /** Whom a system message is about (`{ user_id }`, D-168); null on a regular one. */
    @Expose()
    // As it is: an untyped object would otherwise come out empty, every key not @Expose()d.
    @Transform(({ obj }: { obj: { systemData?: unknown } }) => obj.systemData ?? null, { toClassOnly: true })
    @ApiProperty({ type: Object, nullable: true })
    @IsOptional()
    @IsObject()
    systemData: Record<string, unknown> | null

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

    @Expose()
    @IsDate()
    createdAt: Date
}
