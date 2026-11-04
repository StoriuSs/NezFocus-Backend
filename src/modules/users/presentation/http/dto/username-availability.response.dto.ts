import { Expose } from 'class-transformer'
import { IsBoolean } from 'class-validator'

/**
 * Response for the username availability check
 */
export class UsernameAvailabilityResponseDto {
    @Expose()
    @IsBoolean()
    available: boolean
}
