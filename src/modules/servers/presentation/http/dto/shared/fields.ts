import { CHANNEL_NAME_MAX_LENGTH } from '../../../../domain'

/*
 * Input limits several DTOs share. They only bound what is sent: whether a
 * value is allowed is decided in the domain (VALIDATION_ERROR with `data.rule`).
 */

/** Permission bits as a decimal string: past what a JSON number holds exactly. Read with BigInt(). */
export const BITS = /^\d{1,20}$/
/** Room for spaces trimmed off and what normalising removes ("Q&A!!" → "qa"); the stored name is held to 100. */
export const TYPED_MAX = CHANNEL_NAME_MAX_LENGTH * 4
/** Far past any server's last page, low enough that the offset stays an exact integer. */
export const MAX_PAGE = 100_000
/** More view roles than a server can have (50) is not a real request. */
export const MAX_VIEW_ROLES = 100
