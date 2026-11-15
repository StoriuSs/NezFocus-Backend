/**
 * Channel Directory Port — what the servers module tells other modules about
 * where a channel is. The messaging module asks it on every message route,
 * which names only the channel (`/channels/{id}/messages`), to learn whose
 * permissions apply; the realtime module, for the rooms of a server's
 * channels.
 *
 * Only the place: whether the person may see or post in it is the
 * permissions module's to answer (PERMISSION_CHECKER).
 */
export interface ChannelDirectoryPort {
    /** The server the channel is in; null when there is no such channel or its server was deleted. */
    serverIdOf(channelId: string): Promise<string | null>

    /**
     * Every channel of the server, text or voice, also of a server just
     * deleted (its channels stay until the clean-up): the rooms a socket
     * leaves when it may no longer be there (D-178). A channel deleted is no
     * longer here: its room hears nothing again. In no order.
     */
    channelIdsOf(serverId: string): Promise<string[]>
}

export const CHANNEL_DIRECTORY = Symbol('ChannelDirectoryPort')
