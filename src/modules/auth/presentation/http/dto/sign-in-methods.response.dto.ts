import { Expose } from 'class-transformer'
import { IsBoolean, IsString } from 'class-validator'

export class SignInMethodsResponseDto {
    /** The account has a password: email-and-password sign-in works. False for one made with Google, until a password is set. */
    @Expose()
    @IsBoolean()
    password: boolean

    /** Other providers linked to the account, by id (`google`). */
    @Expose()
    @IsString({ each: true })
    providers: string[]
}
