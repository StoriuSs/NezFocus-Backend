import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator'
import { BITS } from './shared/fields'

export class ServerChannelResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Null: listed above the first category. */
    @Expose()
    @IsOptional()
    @IsString()
    categoryId: string | null

    @Expose()
    @IsIn(['text', 'voice'])
    type: 'text' | 'voice'

    @Expose()
    @IsString()
    name: string

    /** Order within its category, 0 first. */
    @Expose()
    @IsInt()
    position: number

    @Expose()
    @IsBoolean()
    isPrivate: boolean

    /** `managers`: only those with MANAGE_MESSAGES may post. */
    @Expose()
    @IsIn(['everyone', 'managers'])
    sendMode: 'everyone' | 'managers'

    @Expose()
    @IsBoolean()
    isStudyRoom: boolean

    @Expose()
    @IsBoolean()
    taskBoardEnabled: boolean

    /** What they may do in this channel (appendix B, steps 1–6). */
    @ApiProperty({ example: '3657472' })
    @Expose()
    @Matches(BITS)
    permissions: string

    /** The roles that see it when private, sent only to those who may edit that; null otherwise. */
    @ApiProperty({ type: [String], nullable: true })
    @Expose()
    @IsOptional()
    @IsString({ each: true })
    viewRoleIds: string[] | null
}
