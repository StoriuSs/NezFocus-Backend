import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { ValidateBy } from 'class-validator'
import {
    BIO_MAX_LENGTH,
    DISPLAY_NAME_MAX_LENGTH,
    isBio,
    isDisplayName,
    normaliseProfileText
} from '@/modules/users/domain/profile-text.rules'

/** Composes (NFC) and trims a string; anything else is left for the validator to refuse. */
const normalised = () =>
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normaliseProfileText(value) : value))

/**
 * A display name (REQ-AUTH-06, D-139): 1-32 characters counted in code
 * points, at least one visible, no control characters. JSON Schema's
 * `maxLength` counts code points too, so the spec says the same thing.
 */
export const DisplayNameField = (required: boolean) =>
    applyDecorators(
        ApiProperty({ required, minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH }),
        normalised(),
        ValidateBy({
            name: 'isDisplayName',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && isDisplayName(value),
                defaultMessage: () =>
                    `display_name must be 1-${DISPLAY_NAME_MAX_LENGTH} characters, at least one of them visible, with no line breaks or other control characters`
            }
        })
    )

/** A bio (REQ-AUTH-06): up to 200 characters, line breaks allowed; empty clears it. */
export const BioField = () =>
    applyDecorators(
        ApiProperty({ required: false, maxLength: BIO_MAX_LENGTH }),
        normalised(),
        ValidateBy({
            name: 'isBio',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && isBio(value),
                defaultMessage: () =>
                    `bio must be at most ${BIO_MAX_LENGTH} characters, with no control characters other than line breaks`
            }
        })
    )
