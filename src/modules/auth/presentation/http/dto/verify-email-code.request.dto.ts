import { EmailCodeFields } from './shared/fields.dto'

/** POST /auth/email-code/verify: the address and the code emailed to it. */
export class VerifyEmailCodeRequestDto extends EmailCodeFields {}
