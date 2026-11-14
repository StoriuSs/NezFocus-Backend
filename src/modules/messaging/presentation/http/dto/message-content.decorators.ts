import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { ValidateBy } from 'class-validator'
import { isMessageContent, MAX_MESSAGE_LENGTH, normaliseMessageContent } from '../../../domain'

/**
 * A message's text (REQ-MSG-01): composed (NFC) and without the blank around
 * it, then at most 2000 characters counted in code points (an emoji, or a
 * letter with its accents, is one). JSON Schema's `maxLength` counts code
 * points too. Empty is for a message of files alone (D-93): with no file
 * either, the handler refuses it (VALIDATION_ERROR).
 */
export const MessageContentField = () =>
    applyDecorators(
        ApiProperty({ minLength: 0, maxLength: MAX_MESSAGE_LENGTH }),
        Transform(({ value }: { value: unknown }) =>
            typeof value === 'string' ? normaliseMessageContent(value) : value
        ),
        ValidateBy({
            name: 'isMessageContent',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && isMessageContent(value),
                defaultMessage: () =>
                    `content must be at most ${MAX_MESSAGE_LENGTH} characters once the blank around it is dropped`
            }
        })
    )
