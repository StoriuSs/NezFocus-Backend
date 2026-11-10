import { ApiProperty } from '@nestjs/swagger'
import { IsString, MaxLength } from 'class-validator'
import { CHANNEL_NAME_MAX_LENGTH } from '../../../domain'
import { TYPED_MAX } from './shared/fields'

/*
 * Roles and members (REQ-ROLE-01, ROLE-02, S-SET-02, D-152, D-153). Names
 * and bits are only bounded here; whether they are allowed is decided in
 * domain/roles.ts (VALIDATION_ERROR with `data.rule`).
 */

/** POST /servers/{id}/roles: no permissions, not mentionable, right below one's highest role (D-87). */
export class CreateRoleRequestDto {
    @ApiProperty({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IsString()
    @MaxLength(TYPED_MAX)
    name: string
}
