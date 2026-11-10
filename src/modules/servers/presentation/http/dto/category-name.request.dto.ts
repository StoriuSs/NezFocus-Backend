import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH } from '../../../domain'
import { TYPED_MAX } from './shared/fields'

/*
 * Bodies of the channel list routes (REQ-SRV-02). Names are only bounded
 * here: what they are stored as, and whether that is allowed, depends on the
 * kind of channel and is decided in domain/channel-layout.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

/** POST /servers/{id}/categories, PATCH …/categories/{cid}. */
export class CategoryNameRequestDto {
    /** 1–100 characters, kept as typed; the list shows it in capitals. */
    @ApiProperty({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IsString()
    @MaxLength(TYPED_MAX)
    name: string
}
