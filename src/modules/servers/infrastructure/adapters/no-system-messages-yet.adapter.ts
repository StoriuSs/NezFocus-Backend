import { Injectable } from '@nestjs/common'
import { SystemMessagesPort } from '../../application/ports'

/**
 * Messages arrive in M2, which plugs in the adapter that posts "X joined the
 * server" to the welcome channel (D-83). Until then joining posts nothing.
 */
@Injectable()
export class NoSystemMessagesYet implements SystemMessagesPort {
    async memberJoined(): Promise<void> {}
}
