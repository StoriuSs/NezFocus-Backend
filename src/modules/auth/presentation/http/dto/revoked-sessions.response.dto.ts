import { Expose } from 'class-transformer'
import { IsInt } from 'class-validator'

/** What "Sign out the other devices" ended. */
export class RevokedSessionsResponseDto {
    /** How many sessions ended: "Signed out 2 other devices". */
    @Expose()
    @IsInt()
    revoked: number
}
