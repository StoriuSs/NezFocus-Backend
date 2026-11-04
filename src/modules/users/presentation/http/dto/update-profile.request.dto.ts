import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import { Transform } from 'class-transformer'
import { trimString } from '@/shared/utils/transform.util'

/**
 * HTTP Request DTO for updating user profile
 * class-validator decorators apply here (presentation concern)
 *
 * Limits match the response DTOs. Without them a 100 KB bio (body-parser's
 * limit) was stored, cached in Redis and sent back on every /users/me, and an
 * empty display name blanked the profile.
 */
export class UpdateProfileRequestDto {
    @Transform(trimString)
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'displayName must not be empty' })
    @MaxLength(100)
    displayName?: string

    /** An empty string clears the bio. */
    @Transform(trimString)
    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio?: string
}
