/** A value a template can show: plain, or a list or group of them (`{{#each}}`, `{{a.b}}`). */
export type EmailValue = string | number | boolean | undefined | null | EmailValue[] | { [key: string]: EmailValue }

/** What an email template is given. */
export interface EmailContext {
    [key: string]: EmailValue
}
