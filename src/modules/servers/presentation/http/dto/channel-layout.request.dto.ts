import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    ValidateIf
} from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH } from '../../../domain'

/*
 * Bodies of the channel list routes (REQ-SRV-02). Names are only bounded
 * here: what they are stored as, and whether that is allowed, depends on the
 * kind of channel and is decided in domain/channel-layout.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

/** Room for what normalising removes ("Q&A!!" → "qa"); the stored name is held to 100. */
const TYPED_MAX = CHANNEL_NAME_MAX_LENGTH * 4
/** More view roles than a server can have (50) is not a real request. */
const MAX_ROLES = 100

/** POST /servers/{id}/categories, PATCH …/categories/{cid}. */
export class CategoryNameRequestDto {
    /** 1–100 characters, kept as typed; the list shows it in capitals. */
    @ApiProperty({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IsString()
    @MaxLength(TYPED_MAX)
    name: string
}

/** POST /servers/{id}/channels (S-SRV-05). */
export class CreateChannelRequestDto {
    @ApiProperty({ enum: ['text', 'voice'] })
    @IsIn(['text', 'voice'])
    type: 'text' | 'voice'

    /** A text channel's is stored normalised: "Hỏi Đáp Chung" → "hỏi-đáp-chung". */
    @ApiProperty({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IsString()
    @MaxLength(TYPED_MAX)
    name: string

    /** Left out or null: above the first category. */
    @ApiPropertyOptional({ nullable: true, format: 'uuid' })
    @IsOptional()
    @IsUUID()
    categoryId?: string | null

    /** Voice rooms only: a shared Pomodoro, 25/5 to start with (D-45). */
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isStudyRoom?: boolean

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isPrivate?: boolean

    /** For a private channel: the roles that see it, not @everyone. */
    @ApiPropertyOptional({ type: [String], format: 'uuid' })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_ROLES)
    @IsUUID(undefined, { each: true })
    viewRoleIds?: string[]
}

/** PATCH /servers/{id}/channels/{cid} (S-SET-05): only what is sent changes. */
export class UpdateChannelRequestDto {
    @ApiPropertyOptional({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(TYPED_MAX)
    name?: string

    /** Text channels: `managers` lets only MANAGE_MESSAGES post. */
    @ApiPropertyOptional({ enum: ['everyone', 'managers'] })
    @IsOptional()
    @IsIn(['everyone', 'managers'])
    sendMode?: 'everyone' | 'managers'

    /** Public again: its view roles are cleared. */
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isPrivate?: boolean

    /** Replaces the whole set. */
    @ApiPropertyOptional({ type: [String], format: 'uuid' })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_ROLES)
    @IsUUID(undefined, { each: true })
    viewRoleIds?: string[]
}

/**
 * PATCH /servers/{id}/channels/order (S-SRV-06, D-149): one drop. A channel
 * goes into `category_id` (null: outside any) right after `after_id`; a
 * category right after the category `after_id`. `after_id` null: first.
 * Both must be given, null or not, so a forgotten field never moves anything.
 */
export class MoveInLayoutRequestDto {
    @ApiProperty({ enum: ['channel', 'category'] })
    @IsIn(['channel', 'category'])
    kind: 'channel' | 'category'

    @ApiProperty({ format: 'uuid' })
    @IsUUID()
    id: string

    /** Channels only. */
    @ApiPropertyOptional({ nullable: true, format: 'uuid' })
    @ValidateIf((dto: MoveInLayoutRequestDto) => dto.kind === 'channel' && dto.categoryId !== null)
    @IsUUID()
    categoryId?: string | null

    @ApiProperty({ nullable: true, format: 'uuid' })
    @ValidateIf((dto: MoveInLayoutRequestDto) => dto.afterId !== null)
    @IsUUID()
    afterId: string | null
}
