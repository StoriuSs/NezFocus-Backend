import type { BlockingServer } from '@/modules/auth/domain'

/**
 * Server Ownership Port — what deleting an account asks of the servers an
 * account owns (REQ-AUTH-09). Defined here, answered by the servers module
 * from its own tables (D-160): auth never imports it.
 */
export interface ServerOwnershipPort {
    /** Those with other members: ownership is handed over first (D-76). */
    serversBlockingDeletion(userId: string): Promise<BlockingServer[]>
    /**
     * Revoke every invite of the live servers they own alone, which go with
     * the account when its 14 days are over (D-121): a stranger joining
     * meanwhile would leave a server with members and no owner.
     */
    revokeSoloServerInvites(userId: string): Promise<void>
}

export const SERVER_OWNERSHIP = Symbol('ServerOwnershipPort')
