import { Expose, Type } from 'class-transformer'
import { IsBoolean, ValidateNested } from 'class-validator'
import { TokenResponseDto } from './token.response.dto'

/** The account a code signed in to. */
export class SignedInAccountDto {
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

/** An access token (the refresh token is in the cookie), and the account it is for. */
export class EmailCodeSignInResponseDto extends TokenResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => SignedInAccountDto)
    account: SignedInAccountDto
}
