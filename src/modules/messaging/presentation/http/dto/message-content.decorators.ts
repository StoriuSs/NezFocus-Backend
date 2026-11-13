import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { ValidateBy } from 'class-validator'
import { isMessageContent, MAX_MESSAGE_LENGTH, normaliseMessageContent } from '../../../domain'

/**
 * A message's text (REQ-MSG-01): composed (NFC) and without the blank around
 * it, then 1-2000 characters counted in code points (an emoji, or a letter
 * with its accents, is one). JSON Schema's `maxLength` counts code points
 * too. Nothing left is refused like any other field (VALIDATION_ERROR).
 */
export const MessageContentField = () =>
    applyDecorators(
        ApiProperty({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH }),
        Transform(({ value }: { value: unknown }) =>
            typeof value === 'string' ? normaliseMessageContent(value) : value
        ),
        ValidateBy({
            name: 'isMessageContent',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && isMessageContent(value),
                defaultMessage: () =>
                    `content must be 1-${MAX_MESSAGE_LENGTH} characters once the blank around it is dropped`
            }
        })
    )
