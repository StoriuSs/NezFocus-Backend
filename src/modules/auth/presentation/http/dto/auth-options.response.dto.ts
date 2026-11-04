import { Expose } from 'class-transformer'
import { IsOptional, IsString } from 'class-validator'

export class AuthOptionsResponseDto {
    /**
     * The other providers configured for sign-in, by id (`google`). Empty when
     * none are. Start one with `GET /auth/<id>`.
     */
    @Expose()
    @IsString({ each: true })
    providers: string[]

    /**
     * The Turnstile widget's site key, when Turnstile is on; null when it is
     * off. Public: it is meant to be in the page.
     */
    @Expose()
    @IsOptional()
    @IsString()
    turnstileSiteKey: string | null
}
