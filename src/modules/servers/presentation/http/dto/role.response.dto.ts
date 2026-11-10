import { Expose } from 'class-transformer'
import { IsBoolean, IsInt, IsString, Matches } from 'class-validator'
import { BITS } from './shared/fields'

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
