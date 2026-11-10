import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsString, Matches, MaxLength, ValidateIf } from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH } from '../../../domain'
import { BITS, TYPED_MAX } from './shared/fields'

/*
 * Roles and members (REQ-ROLE-01, ROLE-02, S-SET-02, D-152, D-153). Names
 * and bits are only bounded here; whether they are allowed is decided in
 * domain/roles.ts (VALIDATION_ERROR with `data.rule`).
 */

/** Checked only when sent: `null` is not "not sent", and is refused (as update-profile.request.dto.ts). */
const IfSent = () => ValidateIf((_dto: object, value: unknown) => value !== undefined)

/** PATCH /servers/{id}/roles/{rid}: only what is sent changes. @everyone takes only `permissions`. */
export class UpdateRoleRequestDto {
    @ApiPropertyOptional({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IfSent()
    @IsString()
    @MaxLength(TYPED_MAX)
    name?: string

    /** The whole set after the change, as a decimal string. */
    @ApiPropertyOptional({ example: '1280' })
    @IfSent()
    @IsString()
    @Matches(BITS)
    permissions?: string

    /** "Allow anyone to @mention this role". */
    @ApiPropertyOptional()
    @IfSent()
    @IsBoolean()
    mentionable?: boolean
}
