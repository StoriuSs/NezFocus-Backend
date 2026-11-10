import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import {
    IsDate,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested
} from 'class-validator'
import { REASON_MAX_LENGTH, TIMEOUT_SECONDS } from '../../../domain'
import { MAX_PAGE, PageMetaResponseDto } from './role.dto'
import { ServerIdParamsDto } from './server-id.params.dto'

/*
 * Kick, ban, unban and timeout (REQ-ROLE-04, S-SET-03, S-SET-04). A reason is
 * only bounded here; trimmed and held to 512 in domain/moderation.ts
 * (VALIDATION_ERROR with `data.rule`).
 */

/** Room for spaces trimmed off. */
const TYPED_REASON_MAX = REASON_MAX_LENGTH * 4

export class ServerMemberParamsDto extends ServerIdParamsDto {
    @IsUUID()
    userId: string
}

/** An optional reason, shown to the one acted on (D-156 for a kick). */
export class ModerationReasonRequestDto {
    @ApiPropertyOptional({ type: String, nullable: true, maxLength: REASON_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(TYPED_REASON_MAX)
    reason?: string | null
}

/**
 * PATCH /servers/{id}/members/{user_id}: time out for one of the six lengths
 * from now (a new length for a running one too), or end it with null.
 */
export class TimeoutMemberRequestDto extends ModerationReasonRequestDto {
    @ApiProperty({ type: Number, nullable: true, enum: TIMEOUT_SECONDS })
    @ValidateIf((_dto: object, value: unknown) => value !== null)
    @IsIn(TIMEOUT_SECONDS)
    timeoutSeconds: number | null
}

/** GET /servers/{id}/bans: newest first. */
export class BanListQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE)
    page?: number

    /** 10, 50 or 100 (D-90); 50 when left out. */
    @IsOptional()
    @Type(() => Number)
    @IsIn([10, 50, 100])
    limit?: number
}

/** Names are null once their account is deleted. */
export class BanPersonResponseDto {
    @Expose()
    @IsString()
    userId: string

    @Expose()
    @IsOptional()
    @IsString()
    username: string | null

    @Expose()
    @IsOptional()
    @IsString()
    displayName: string | null

    @Expose()
    @IsOptional()
    @IsString()
    avatarUrl: string | null
}

export class BanResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => BanPersonResponseDto)
    user: BanPersonResponseDto

    @Expose()
    @IsOptional()
    @IsString()
    reason: string | null

    @Expose()
    @IsDate()
    createdAt: Date

    /** Null when that account is gone for good. */
    @Expose()
    @ApiProperty({ type: BanPersonResponseDto, nullable: true })
    @IsOptional()
    @ValidateNested()
    @Type(() => BanPersonResponseDto)
    bannedBy: BanPersonResponseDto | null
}

export class BanPageResponseDto {
    @Expose()
    @ApiProperty({ type: [BanResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => BanResponseDto)
    items: BanResponseDto[]

    @Expose()
    @ValidateNested()
    @Type(() => PageMetaResponseDto)
    meta: PageMetaResponseDto
}
