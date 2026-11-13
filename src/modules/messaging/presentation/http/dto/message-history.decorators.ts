import { registerDecorator, ValidationArguments } from 'class-validator'

/**
 * The field may be given only when none of `others` is: a history page
 * starts from one place (SRS 5.1). Only checked when the field is given.
 */
export function AloneAmong(others: string[]): PropertyDecorator {
    return (target: object, propertyName: string | symbol) =>
        registerDecorator({
            name: 'aloneAmong',
            target: target.constructor,
            propertyName: propertyName as string,
            constraints: others,
            options: { message: `${String(propertyName)} cannot be combined with ${others.join(' or ')}` },
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    if (value === undefined) return true
                    const dto = args.object as Record<string, unknown>
                    return others.every((other) => dto[other] === undefined)
                }
            }
        })
}
