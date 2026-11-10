import { Expose } from 'class-transformer'
import { IsBoolean } from 'class-validator'

/** The account a code signed in to. */
export class SignedInAccountResponseDto {
    /** Made by this sign-in: the address had no account (D-59). */
    @Expose()
    @IsBoolean()
    created: boolean

    /**
     * Done the "complete your account" step. False: open it before anything
     * else (D-61). The gate that refuses it everywhere else comes with that
     * step (D-128).
     */
    @Expose()
    @IsBoolean()
    completed: boolean
}
