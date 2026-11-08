import type { BlockingServer } from '@/modules/auth/domain'

/**
 * Server Ownership Port — the servers an account owns that stop it being
 * deleted: those with other members (REQ-AUTH-09, D-76). Ownership is handed
 * over first. Servers arrive in M1, which answers this from its own tables;
 * until then there are none (NoServersYet).
 */
export interface ServerOwnershipPort {
    serversBlockingDeletion(userId: string): Promise<BlockingServer[]>
}

export const SERVER_OWNERSHIP = Symbol('ServerOwnershipPort')
