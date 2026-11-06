import { Expose } from 'class-transformer'
import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator'
import { USERNAME_MAX_LENGTH } from '@/modules/users/domain'

/**
 * The signed-in user's account (the auth module) and profile (the users module).
 * Returned by GET /api/v1/users/me
 */
export class UserProfileResponseDto {
    @Expose()
    @IsString()
    id: string

    /** Absent only for an account whose personal data has been erased. */
    @Expose()
    @IsOptional()
    @IsEmail()
    email?: string

    @Expose()
    @IsOptional()
    @IsString()
    @MaxLength(USERNAME_MAX_LENGTH)
    username?: string

    @Expose()
    @IsOptional()
    @IsString()
    @MaxLength(100)
    displayName?: string

    @Expose()
    @IsOptional()
    @IsString()
    avatarUrl: string | null

    @Expose()
    @IsArray()
    @IsString({ each: true })
    roles: string[]

    @Expose()
    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio?: string

    @Expose()
    @IsBoolean()
    hasSetUsername: boolean
}
