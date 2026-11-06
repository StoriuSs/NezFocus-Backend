import { SetMetadata } from '@nestjs/common'

export const ALLOW_INCOMPLETE_KEY = 'allowIncomplete'

/**
 * A signed-in route an account may use before it is completed (D-61, D-128):
 * only what the "complete your account" page itself needs. Every other
 * signed-in route answers ACCOUNT_INCOMPLETE until then (AccessTokenGuard).
 */
export const AllowIncomplete = () => SetMetadata(ALLOW_INCOMPLETE_KEY, true)
