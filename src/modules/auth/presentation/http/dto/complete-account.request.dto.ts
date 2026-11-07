import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { Equals, IsIn, IsString, Matches, MaxLength, MinLength, ValidateBy } from 'class-validator'
import { trimString } from '@/shared/utils/transform.util'
import { canonicalTimeZone, DisplayNameField, normaliseUsername, USERNAME_PATTERN } from '@/modules/users'
import { EMAIL_LANGUAGES, type EmailLanguage } from '@/modules/auth/application/ports'
import { PASSWORD_INPUT_MAX } from './shared/fields.dto'

/** An IANA zone name ICU knows; not an offset (timezone.rules.ts). */
const IsTimeZoneName = () =>
    ValidateBy({
        name: 'isTimeZoneName',
        validator: {
            validate: (value: unknown) => typeof value === 'string' && canonicalTimeZone(value) !== null,
            defaultMessage: () => 'timezone must be an IANA time zone name, such as Asia/Ho_Chi_Minh'
        }
    })

/**
 * The "complete your account" page (S-ONB-01, REQ-AUTH-01, D-61). Every
 * field is required.
 */
export class CompleteAccountRequestDto {
    /** Shown in chat and study rooms: 1-32 characters, at least one visible (REQ-AUTH-06, D-69, D-139). */
    @DisplayNameField(true)
    displayName: string

    /**
     * 2-32 characters of `a-z 0-9 _ .`; upper case is lowered. Permanent.
     * Whether it is free is decided now: taken → USERNAME_CONFLICT.
     */
    @Transform(({ value }) => (typeof value === 'string' ? normaliseUsername(value) : value))
    @IsString()
    @Matches(USERNAME_PATTERN, { message: 'username must be 2-32 lowercase letters, numbers, underscores or dots' })
    username: string

    /**
     * The password, under the rules of REQ-AUTH-01; it may not be the email,
     * the part before @, or this username (D-66). Refused →
     * AUTH_PASSWORD_REJECTED naming the rules broken.
     */
    @IsString()
    @MinLength(1)
    @MaxLength(PASSWORD_INPUT_MAX)
    password: string

    /** An IANA time zone name, e.g. `Asia/Ho_Chi_Minh`. Does not count as the day's change (D-61). */
    @Transform(trimString)
    @IsTimeZoneName()
    timezone: string

    /** The account's language: the switch at the foot of the page (D-64). */
    @ApiProperty({ enum: EMAIL_LANGUAGES })
    @IsIn(EMAIL_LANGUAGES, { message: 'language must be vi or en' })
    language: EmailLanguage

    /**
     * "I agree to the Terms of Service and the Privacy Policy": must be true.
     * The value as sent: the global pipe's implicit conversion would make
     * the string "false" true, recording consent nobody gave.
     */
    @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.termsAccepted, { toClassOnly: true })
    @Equals(true, { message: 'terms_accepted must be true' })
    termsAccepted: boolean
}
