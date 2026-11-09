import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { SERVER_NAME_MAX_LENGTH } from '../../../domain'

/**
 * PATCH /servers/{id} (S-SET-01). A field left out stays as it is. The name
 * is only bounded here: composed, trimmed and held to 2–100 in
 * domain/server-settings.ts (VALIDATION_ERROR with `data.rule`).
 */
export class UpdateServerRequestDto {
    @ApiPropertyOptional({ minLength: 2, maxLength: SERVER_NAME_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(SERVER_NAME_MAX_LENGTH * 4)
    name?: string

    /** A text channel of the server; null: "Send none" (D-83). */
    @ApiPropertyOptional({ nullable: true, format: 'uuid' })
    @IsOptional()
    @IsUUID()
    welcomeChannelId?: string | null
}
