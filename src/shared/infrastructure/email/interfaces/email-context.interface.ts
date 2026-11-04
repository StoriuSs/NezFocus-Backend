/** What an email template is given. */
export interface EmailContext {
    [key: string]: string | number | boolean | undefined | null
}
