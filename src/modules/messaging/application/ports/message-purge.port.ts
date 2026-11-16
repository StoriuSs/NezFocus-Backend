import type { MessageWindow } from '@/modules/servers'

/**
 * Message Purge Port: deleting many messages, handed to a queue so it is
 * retried and survives a restart (D-181). Queueing the same ban twice is one
 * job.
 */
export interface MessagePurgePort {
    /** Delete the regular messages the user sent in the server's channels within the window, soon. */
    deleteRecentLater(serverId: string, userId: string, window: MessageWindow): Promise<void>
}

export const MESSAGE_PURGE = Symbol('MessagePurgePort')
