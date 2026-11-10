import { ApiProperty } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import {
    IsBoolean,
    IsDate,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested
} from 'class-validator'
import { INVITE_MAX_AGES, INVITE_MAX_USES } from '../../../domain'
import { ServerResponseDto } from './server.response.dto'

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

export class InviteCodeParamsDto {
    /** Checked against 8–10 letters and digits by the handler, so a bad one counts as a wrong code. */
    @IsString()
    @MaxLength(64)
    code: string
}

export class InvitePreviewQueryDto {
    /** The `?channel=` of the link (D-150). Not one someone joining sees: ignored. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    channel?: string
}

export class InviteResponseDto {
    /** The link is /invite/{code}. */
    @Expose()
    @IsString()
    code: string

    /** The lifetime chosen; null: never expires. */
    @Expose()
    @IsOptional()
    @IsInt()
    maxAgeSeconds: number | null

    /** Null: no limit. */
    @Expose()
    @IsOptional()
    @IsInt()
    maxUses: number | null

    @Expose()
    @IsInt()
    uses: number

    /** Null: never expires. */
    @Expose()
    @IsOptional()
    @IsDate()
    expiresAt: Date | null

    @Expose()
    @IsDate()
    createdAt: Date
}

/** Who made a link; no name once they have left or the account is deleted (S-SET-04). */
export class InviteCreatorResponseDto {
    @Expose()
    @IsIn(['member', 'left', 'deleted'])
    state: 'member' | 'left' | 'deleted'

    @Expose()
    @IsOptional()
    @IsString()
    displayName?: string | null

    @Expose()
    @IsOptional()
    @IsString()
    username?: string | null
}

export class InviteListItemResponseDto extends InviteResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => InviteCreatorResponseDto)
    creator: InviteCreatorResponseDto
}

export class InviteListResponseDto {
    /** The links that still open, newest first. */
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => InviteListItemResponseDto)
    invites: InviteListItemResponseDto[]
}

export class InviteServerResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Null: show the initials. */
    @Expose()
    @IsOptional()
    @IsString()
    iconUrl: string | null

    @Expose()
    @IsInt()
    memberCount: number
}

/** The channel the link names, when someone joining would see it (D-150). */
export class InviteTargetResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    @Expose()
    @IsIn(['text', 'voice'])
    type: 'text' | 'voice'

    @Expose()
    @IsBoolean()
    isStudyRoom: boolean
}

/** GET /invites/{code} (S-SRV-03). Online counts come with presence in M2 (D-143). */
export class InvitePreviewResponseDto {
    @Expose()
    @IsString()
    code: string

    @Expose()
    @ValidateNested()
    @Type(() => InviteServerResponseDto)
    server: InviteServerResponseDto

    /** Null: the creator has left or the account is deleted ("You're invited to", D-81). */
    @Expose()
    @IsOptional()
    @IsString()
    inviterName: string | null

    @Expose()
    @IsOptional()
    @ValidateNested()
    @Type(() => InviteTargetResponseDto)
    channel: InviteTargetResponseDto | null
}

/** POST /invites/{code}/accept: the server as GET /servers lists it. */
export class AcceptInviteResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => ServerResponseDto)
    server: ServerResponseDto

    /** False: already a member; nothing changed and no use was counted. */
    @Expose()
    @IsBoolean()
    joined: boolean
}
