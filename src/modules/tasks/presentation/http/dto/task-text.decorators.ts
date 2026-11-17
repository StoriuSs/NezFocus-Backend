import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { ValidateBy } from 'class-validator'
import {
    isTaskDescription,
    isTaskTitle,
    normaliseTaskText,
    TASK_DESCRIPTION_MAX_LENGTH,
    TASK_TITLE_MAX_LENGTH
} from '../../../domain'

/** Composes (NFC) and trims a string; anything else is left for the validator to refuse. */
const normalised = () =>
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normaliseTaskText(value) : value))

/**
 * A task's title (REQ-TASK-01): 1-200 characters counted in code points, at
 * least one visible, on one line. JSON Schema's `maxLength` counts code
 * points too.
 */
export const TaskTitleField = (required: boolean) =>
    applyDecorators(
        ApiProperty({ required, minLength: 1, maxLength: TASK_TITLE_MAX_LENGTH }),
        normalised(),
        ValidateBy({
            name: 'isTaskTitle',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && isTaskTitle(value),
                defaultMessage: () =>
                    `title must be 1-${TASK_TITLE_MAX_LENGTH} characters, at least one of them visible, on one line`
            }
        })
    )

/** A task's description (REQ-TASK-01): up to 2000 characters, line breaks allowed; empty for none. */
export const TaskDescriptionField = () =>
    applyDecorators(
        ApiProperty({ required: false, maxLength: TASK_DESCRIPTION_MAX_LENGTH }),
        normalised(),
        ValidateBy({
            name: 'isTaskDescription',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && isTaskDescription(value),
                defaultMessage: () =>
                    `description must be at most ${TASK_DESCRIPTION_MAX_LENGTH} characters, with no control characters other than line breaks`
            }
        })
    )
