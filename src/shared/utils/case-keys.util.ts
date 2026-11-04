import snakecaseKeys from 'snakecase-keys'
import camelcaseKeys from 'camelcase-keys'

type Converter = (input: Record<string, unknown>) => Record<string, unknown>

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * Applies a key-case library to any JSON-shaped value.
 *
 * snakecase-keys and camelcase-keys accept only a plain object or an array of
 * plain objects, and throw on anything else. So a handler returning
 * `['a', 'b']`, or `[{...}, null]`, answered 500 — as did a JSON request body
 * that was an array of strings. Arrays are walked here; primitives, null and
 * non-plain objects (Buffer, Date, ...) pass through untouched.
 */
function convertDeep(value: unknown, convert: Converter): unknown {
    if (Array.isArray(value)) return value.map((item) => convertDeep(item, convert))
    if (isPlainObject(value)) return convert(value)
    return value
}

export const toSnakeCaseKeys = (value: unknown): unknown =>
    convertDeep(value, (input) => snakecaseKeys(input, { deep: true }) as Record<string, unknown>)

export const toCamelCaseKeys = (value: unknown): unknown =>
    convertDeep(value, (input) => camelcaseKeys(input, { deep: true }) as Record<string, unknown>)
