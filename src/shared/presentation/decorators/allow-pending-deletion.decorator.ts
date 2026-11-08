import { SetMetadata } from '@nestjs/common'

export const ALLOW_PENDING_DELETION_KEY = 'allowPendingDeletion'

/**
 * A signed-in route an account waiting to be deleted may use (D-141): only
 * what the "restore your account" dialog needs, the profile and the restore
 * itself. Every other signed-in route answers ACCOUNT_PENDING_DELETION until
 * it is restored (AccessTokenGuard).
 */
export const AllowPendingDeletion = () => SetMetadata(ALLOW_PENDING_DELETION_KEY, true)
