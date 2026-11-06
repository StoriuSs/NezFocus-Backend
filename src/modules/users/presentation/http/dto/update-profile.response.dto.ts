import { Expose } from 'class-transformer'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import { USERNAME_MAX_LENGTH } from '@/modules/users/domain'

/**
 * Response for updateProfile endpoint. Built from the stored user, so unset
 * fields are sent as null rather than left out.
 */
export class UpdateProfileResponseDto {
    @Expose()
    @IsOptional()
    @IsString()
    @MaxLength(USERNAME_MAX_LENGTH)
    username: string | null

    @Expose()
    @IsOptional()
    @IsString()
    @MaxLength(100)
    displayName: string | null

    @Expose()
    @IsOptional()
    @IsString()
    avatarUrl: string | null

    @Expose()
    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio: string | null
}
