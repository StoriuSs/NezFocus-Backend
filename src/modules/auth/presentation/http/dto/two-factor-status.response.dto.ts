import { Expose } from 'class-transformer'
import { IsBoolean, IsInt } from 'class-validator'

export class TwoFactorStatusResponseDto {
    @Expose()
    @IsBoolean()
    enabled: boolean

    /** Unused recovery codes; 0 when two-step sign-in is off. */
    @Expose()
    @IsInt()
    recoveryCodesLeft: number
}
