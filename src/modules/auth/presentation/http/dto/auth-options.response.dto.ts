import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

export class AuthOptionsResponseDto {
    /**
     * The other providers configured for sign-in, by id (`google`). Empty when
     * none are. Start one with `GET /auth/<id>`.
     */
    @Expose()
    @IsString({ each: true })
    providers: string[]
}
