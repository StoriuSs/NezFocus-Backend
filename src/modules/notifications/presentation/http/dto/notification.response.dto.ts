import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { MentionReason, NotificationType } from '../../../domain'
import { NotificationActorResponseDto } from './notification-actor.response.dto'
import { NotificationMessageResponseDto } from './notification-message.response.dto'

const TYPES: NotificationType[] = [
    'mention',
    'reply',
    'task_assigned',
    'task_reminder',
    'task_unassigned',
    'owner_transferred',
    'moderation'
]
const REASONS: MentionReason[] = ['user', 'role', 'everyone', 'here']

/**
 * One inbox item (spec 06, C-29). A mention or reply: the message's place,
 * its author as `actor`, why it is about the reader (`reason`, `role_id` for
 * a role) and the message as it is now. The client names the channel and
 * server from its list of servers.
 */
export class NotificationResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @ApiProperty({ enum: TYPES })
    @IsIn(TYPES)
    type: NotificationType

    @Expose()
    @IsOptional()
    @IsString()
    serverId: string | null

    @Expose()
    @IsOptional()
    @IsString()
    channelId: string | null

    @Expose()
    @IsOptional()
    @IsString()
    messageId: string | null

    @Expose()
    @ApiProperty({ type: NotificationActorResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationActorResponseDto)
    actor: NotificationActorResponseDto | null

    /** A mention: by name, a role, @everyone or @here; null for a reply. */
    @Expose()
    @ApiProperty({ enum: REASONS, nullable: true })
    @IsOptional()
    @IsIn(REASONS)
    reason: MentionReason | null

    @Expose()
    @IsOptional()
    @IsString()
    roleId: string | null

    @Expose()
    @ApiProperty({ type: NotificationMessageResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationMessageResponseDto)
    message: NotificationMessageResponseDto | null

    /** Null while unread. */
    @Expose()
    @ApiProperty({ type: Date, nullable: true })
    @IsOptional()
    @IsDate()
    readAt: Date | null

    @Expose()
    @IsDate()
    createdAt: Date
}
