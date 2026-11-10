import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Expose, Type } from 'class-transformer'
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDate,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested
} from 'class-validator'
import { MEMBER_SORTS, MemberSort, SORT_ORDERS, SortOrder } from '../../../application/ports'
import { CHANNEL_NAME_MAX_LENGTH, MAX_ROLE_GRANT, MAX_ROLES } from '../../../domain'
import { ServerIdParamsDto } from './server-id.params.dto'

/*
 * Roles and members (REQ-ROLE-01, ROLE-02, S-SET-02, D-152, D-153). Names
 * and bits are only bounded here; whether they are allowed is decided in
 * domain/roles.ts (VALIDATION_ERROR with `data.rule`).
 */

/** Permission bits as a decimal string: past what a JSON number holds exactly. Read with BigInt(). */
const BITS = /^\d{1,20}$/
/** Room for spaces trimmed off; the stored name is held to 100. */
const TYPED_MAX = CHANNEL_NAME_MAX_LENGTH * 4
/** Checked only when sent: `null` is not "not sent", and is refused (as update-profile.request.dto.ts). */
const IfSent = () => ValidateIf((_dto: object, value: unknown) => value !== undefined)
/** Far past any server's last page, low enough that the offset stays an exact integer. */
export const MAX_PAGE = 100_000

export class ServerRoleParamsDto extends ServerIdParamsDto {
    @IsUUID()
    roleId: string
}

export class ServerRoleMemberParamsDto extends ServerRoleParamsDto {
    @IsUUID()
    userId: string
}

/** POST /servers/{id}/roles: no permissions, not mentionable, right below one's highest role (D-87). */
export class CreateRoleRequestDto {
    @ApiProperty({ maxLength: CHANNEL_NAME_MAX_LENGTH })
    @IsString()
    @MaxLength(TYPED_MAX)
    name: string
}

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

/** PUT /servers/{id}/roles/{rid}/members: all of them or none (D-153). */
export class GrantRoleRequestDto {
    @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: MAX_ROLE_GRANT })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_ROLE_GRANT)
    @IsUUID(undefined, { each: true })
    userIds: string[]
}

export class RoleResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string

    /** Higher is more senior; @everyone is 0. */
    @Expose()
    @IsInt()
    position: number

    @Expose()
    @IsString()
    @Matches(BITS)
    permissions: string

    @Expose()
    @IsBoolean()
    mentionable: boolean

    @Expose()
    @IsBoolean()
    isEveryone: boolean

    /** For @everyone, every member. */
    @Expose()
    @IsInt()
    memberCount: number
}

/** Highest first, @everyone last. */
export class RoleListResponseDto {
    @Expose()
    @ApiProperty({ type: [RoleResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => RoleResponseDto)
    roles: RoleResponseDto[]
}

export class CreatedRoleResponseDto {
    @Expose()
    @IsString()
    roleId: string
}

/** GET /servers/{id}/members (D-152). */
export class MemberListQueryDto {
    /** Display name or username, ignoring case and accents. */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string

    /** Only those holding this role. */
    @IsOptional()
    @IsUUID()
    roleId?: string

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

    /** name (default), role or joined_at (D-89). */
    @ApiPropertyOptional({ enum: MEMBER_SORTS })
    @IsOptional()
    @IsIn(MEMBER_SORTS)
    sort?: MemberSort

    /** asc (default): A to Z, lowest role first, oldest first. */
    @ApiPropertyOptional({ enum: SORT_ORDERS })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    order?: SortOrder
}

export class MemberResponseDto {
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

    @Expose()
    @IsBoolean()
    isOwner: boolean

    /** Not @everyone. */
    @Expose()
    @IsString({ each: true })
    roleIds: string[]

    @Expose()
    @IsDate()
    joinedAt: Date

    /** Set while a timeout runs; everyone sees it (D-154). */
    @Expose()
    @IsOptional()
    @IsDate()
    timeoutUntil: Date | null

    /** Only for those who may time people out, and for the one timed out (D-154). */
    @Expose()
    @IsOptional()
    @IsString()
    timeoutReason: string | null
}

export class PageMetaResponseDto {
    @Expose()
    @IsInt()
    currentPage: number

    @Expose()
    @IsInt()
    itemsPerPage: number

    @Expose()
    @IsInt()
    totalItems: number

    @Expose()
    @IsInt()
    totalPages: number

    @Expose()
    @IsBoolean()
    hasNextPage: boolean

    @Expose()
    @IsBoolean()
    hasPreviousPage: boolean
}

export class MemberPageResponseDto {
    @Expose()
    @ApiProperty({ type: [MemberResponseDto] })
    @ValidateNested({ each: true })
    @Type(() => MemberResponseDto)
    items: MemberResponseDto[]

    @Expose()
    @ValidateNested()
    @Type(() => PageMetaResponseDto)
    meta: PageMetaResponseDto
}
