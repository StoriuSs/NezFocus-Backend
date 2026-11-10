import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { SignedInAccountResponseDto } from './signed-in-account.response.dto'
import { TokenResponseDto } from './token.response.dto'

/** An access token (the refresh token is in the cookie), and the account it is for. */
export class EmailCodeSignInResponseDto extends TokenResponseDto {
    @Expose()
    @ValidateNested()
    @Type(() => SignedInAccountResponseDto)
    account: SignedInAccountResponseDto
}
