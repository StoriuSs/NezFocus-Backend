/**
 * How addresses are stored and compared everywhere — by the users module and
 * by anything that looks an account up by address: trimmed, lower case.
 */
export const normaliseEmail = (email: string) => email.trim().toLowerCase()
