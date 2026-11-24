import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { MentionReason, NotificationType } from '../../../domain'
import { NotificationActorResponseDto } from './notification-actor.response.dto'
import { NotificationMessageResponseDto } from './notification-message.response.dto'
import { NotificationServerResponseDto } from './notification-server.response.dto'
import { NotificationTaskResponseDto } from './notification-task.response.dto'

const TYPES: NotificationType[] = [
    'mention',
    'reply',
    'task_assigned',
    'task_reminder',
    'task_unassigned',
    'owner_transferred',
    'moderation',
    'friend_request',
    'friend_accepted',
    'missed_call'
]
const REASONS: MentionReason[] = ['user', 'role', 'everyone', 'here']

/**
 * One inbox item (spec 06, C-29). A mention or reply: the message's place,
 * its author as `actor`, why it is about the reader (`reason`, `role_id` for
 * a role) and the message as it is now. A task item: the task's id, who
 * acted (`actor`, none on a reminder) and the task as it was then (`task`,
 * D-98). A server handed over: the old owner as `actor` and `server`; a
 * moderation item: `server` with what was done, never who (REQ-ROLE-04).
 * A friend request: who asked as `actor` and their `note`, if any; a request
 * accepted: who accepted as `actor` (D-111). Both belong to no server
 * (D-242). The client names the channel and server of other items from its
 * list of servers.
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
    @IsOptional()
    @IsString()
    taskId: string | null

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

    @Expose()
    @ApiProperty({ type: NotificationTaskResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationTaskResponseDto)
    task: NotificationTaskResponseDto | null

    @Expose()
    @ApiProperty({ type: NotificationServerResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => NotificationServerResponseDto)
    server: NotificationServerResponseDto | null

    /** A friend request's note, at most 150 characters; null for every other item (REQ-SOCIAL-01). */
    @Expose()
    @IsOptional()
    @IsString()
    note: string | null

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
