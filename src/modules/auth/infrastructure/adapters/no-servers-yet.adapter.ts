import { Injectable } from '@nestjs/common'
import type { BlockingServer } from '@/modules/auth/domain'
import type { ServerOwnershipPort } from '@/modules/auth/application/ports'

/**
 * ServerOwnershipPort before servers exist (M0): nobody owns one, so nothing
 * stops a deletion. The servers module replaces it in M1.
 */
@Injectable()
export class NoServersYet implements ServerOwnershipPort {
    serversBlockingDeletion(): Promise<BlockingServer[]> {
        return Promise.resolve([])
    }
}
