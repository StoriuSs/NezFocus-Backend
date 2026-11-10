import { ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH } from '../../../domain'
import { MAX_VIEW_ROLES, TYPED_MAX } from './shared/fields'

/*
 * Bodies of the channel list routes (REQ-SRV-02). Names are only bounded
 * here: what they are stored as, and whether that is allowed, depends on the
 * kind of channel and is decided in domain/channel-layout.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

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
    @ArrayMaxSize(MAX_VIEW_ROLES)
    @IsUUID(undefined, { each: true })
    viewRoleIds?: string[]
}
