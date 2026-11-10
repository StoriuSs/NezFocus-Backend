import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator'
import { MAX_ROLES } from '../../../domain'

/**
 * PATCH /servers/{id}/roles/order: every role but @everyone, highest first,
 * in the new order and in the order the client was showing. When the second
 * is no longer the order, CONFLICT_ERROR: reload and drag again.
 */
export class ReorderRolesRequestDto {
    @ApiProperty({ type: [String], format: 'uuid' })
    @IsArray()
    @ArrayMaxSize(MAX_ROLES)
    @IsUUID(undefined, { each: true })
    order: string[]

    @ApiProperty({ type: [String], format: 'uuid' })
    @IsArray()
    @ArrayMaxSize(MAX_ROLES)
    @IsUUID(undefined, { each: true })
    seenOrder: string[]
}
