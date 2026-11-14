import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsOptional, IsString } from 'class-validator'
import { MEMBER_PRESENCES } from '../../../application/ports'

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

    /** What others see of them now (REQ-AUTH-07): someone invisible is offline. */
    @Expose()
    @ApiProperty({ enum: MEMBER_PRESENCES })
    @IsIn(MEMBER_PRESENCES)
    status: (typeof MEMBER_PRESENCES)[number]
}
