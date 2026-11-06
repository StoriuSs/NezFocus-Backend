import { IsString, Matches } from 'class-validator'
import { Transform } from 'class-transformer'
import { USERNAME_PATTERN, normaliseUsername } from '@/modules/users/domain'

/**
 * Route params for the username availability check. Validated with the same
 * rule as the "complete your account" step (CompleteAccountRequestDto): `a` or `a b` used to be reported "available"
 * and then rejected on submit.
 */
export class CheckUsernameParamsDto {
    @Transform(({ value }) => (typeof value === 'string' ? normaliseUsername(value) : value))
    @IsString()
    @Matches(USERNAME_PATTERN, {
        message: 'username must be 2-32 lowercase letters, numbers, underscores or dots'
    })
    username: string
}
