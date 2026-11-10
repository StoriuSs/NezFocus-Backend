import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator'
import { MAX_ROLE_GRANT } from '../../../domain'

/** PUT /servers/{id}/roles/{rid}/members: all of them or none (D-153). */
export class GrantRoleRequestDto {
    @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: MAX_ROLE_GRANT })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_ROLE_GRANT)
    @IsUUID(undefined, { each: true })
    userIds: string[]
}
