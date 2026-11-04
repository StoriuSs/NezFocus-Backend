/**
 * For class-transformer's `@Transform` on request DTOs: trims a string and
 * leaves anything else for the validators to refuse.
 *
 * @example
 * @Transform(trimString)
 * @IsEmail()
 * email: string
 */
export const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)
