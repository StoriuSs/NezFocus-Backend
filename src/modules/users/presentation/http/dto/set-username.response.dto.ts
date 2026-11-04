import { Expose } from 'class-transformer'
import { IsBoolean, IsString } from 'class-validator'

/**
 * Response for setUsername endpoint
 */
export class SetUsernameResponseDto {
    @Expose()
    @IsString()
    username: string

    @Expose()
    @IsBoolean()
    hasSetUsername: boolean
}
