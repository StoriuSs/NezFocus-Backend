/**
 * Safely parse integer from environment variable
 * @param value - Environment variable value (can be undefined)
 * @param defaultValue - Default value if parsing fails
 * @returns Parsed integer or default value
 */
export function parseIntSafe(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue
    const parsed = parseInt(value, 10)
    return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Reads a boolean setting the way the Joi schema validates it: `true` in any
 * case, with surrounding spaces. Comparing with `=== 'true'` let
 * EMAIL_SECURE=TRUE pass validation and then mean false.
 */
export function parseBooleanEnv(value: string | undefined): boolean {
    return value?.trim().toLowerCase() === 'true'
}
