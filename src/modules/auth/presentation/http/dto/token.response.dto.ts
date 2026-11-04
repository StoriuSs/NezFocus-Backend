import { Expose } from 'class-transformer'
import { IsIn, IsInt, IsString } from 'class-validator'

/**
 * An access token. The refresh token is not in the body: it is in an httpOnly
 * cookie the page's JavaScript cannot read.
 */
export class TokenResponseDto {
    /** Send as `Authorization: Bearer <access_token>`. Keep it in memory only. */
    @Expose()
    @IsString()
    accessToken: string

    @Expose()
    @IsIn(['Bearer'])
    tokenType: 'Bearer'

    /** Seconds until it expires. Refresh shortly before. */
    @Expose()
    @IsInt()
    expiresIn: number
}
