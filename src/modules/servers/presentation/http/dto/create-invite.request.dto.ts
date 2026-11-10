import { ApiProperty } from '@nestjs/swagger'
import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator'
import { INVITE_MAX_AGES, INVITE_MAX_USES } from '../../../domain'

/** POST /servers/{id}/invites (S-SRV-02). Both fields are required; null is "never" / "no limit". */
export class CreateInviteRequestDto {
    /** 30 minutes, 1 hour, 1 day or 7 days, in seconds; null: never expires. */
    @ApiProperty({ enum: [...INVITE_MAX_AGES], nullable: true, example: 604800 })
    @ValidateIf((_, value) => value !== null)
    @IsIn([...INVITE_MAX_AGES])
    maxAgeSeconds: number | null

    /** 1–100; null: no limit. */
    @ApiProperty({ minimum: 1, maximum: INVITE_MAX_USES, nullable: true, example: null })
    @ValidateIf((_, value) => value !== null)
    @IsInt()
    @Min(1)
    @Max(INVITE_MAX_USES)
    maxUses: number | null
}
