import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsUUID, ValidateIf } from 'class-validator'

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
