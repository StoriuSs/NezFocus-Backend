import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH } from '../../../domain'
import { MAX_VIEW_ROLES, TYPED_MAX } from './shared/fields'

/*
 * Bodies of the channel list routes (REQ-SRV-02). Names are only bounded
 * here: what they are stored as, and whether that is allowed, depends on the
 * kind of channel and is decided in domain/channel-layout.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

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
    @ArrayMaxSize(MAX_VIEW_ROLES)
    @IsUUID(undefined, { each: true })
    viewRoleIds?: string[]
}
