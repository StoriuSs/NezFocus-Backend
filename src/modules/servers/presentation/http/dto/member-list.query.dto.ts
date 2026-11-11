import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { MEMBER_SORTS, MemberSort, SORT_ORDERS, SortOrder } from '../../../domain'
import { MAX_PAGE } from './shared/fields'

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

    /**
     * true: only those the owner may hand the server to (S-SET-07, D-161): not
     * themselves, not an account waiting to be deleted. Owner only.
     */
    @ApiPropertyOptional({ type: Boolean })
    @IsOptional()
    // The raw value: the pipe's implicit conversion has already made "false" true.
    @Transform(({ obj, key }) => {
        const raw: unknown = (obj as Record<string, unknown>)[key]
        return raw === 'true' ? true : raw === 'false' ? false : raw
    })
    @IsBoolean()
    transferable?: boolean

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
