import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, ValidateBy, ValidateIf } from 'class-validator'
import { trimString } from '@/shared/utils/transform.util'
import { canonicalTimeZone } from '@/modules/users/domain/timezone.rules'

/** Checked only when sent: `null` is not "not sent", and is refused rather than read as a value. */
const IfSent = () => ValidateIf((_dto: object, value: unknown) => value !== undefined)

/**
 * An IANA zone name ICU knows, such as `Asia/Ho_Chi_Minh`; not an offset
 * (timezone.rules.ts). Trimmed; the handler stores it in ICU's letter case.
 */
export const TimeZoneField = () =>
    applyDecorators(
        ApiProperty({ example: 'Asia/Ho_Chi_Minh' }),
        Transform(trimString),
        ValidateBy({
            name: 'isTimeZoneName',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && canonicalTimeZone(value) !== null,
                defaultMessage: () => 'timezone must be an IANA time zone name, such as Asia/Ho_Chi_Minh'
            }
        })
    )

/** One of `values`, when sent. */
export const OptionalChoiceField = (values: readonly string[]) =>
    applyDecorators(ApiProperty({ required: false, enum: values }), IfSent(), IsIn(values))

/**
 * A switch, when sent: true or false as sent. The global pipe's implicit
 * conversion would make the string "false" true; the value is taken from the
 * body as it came.
 */
export const OptionalSwitchField = () =>
    applyDecorators(
        ApiProperty({ required: false, type: Boolean }),
        Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key], { toClassOnly: true }),
        IfSent(),
        IsBoolean()
    )
