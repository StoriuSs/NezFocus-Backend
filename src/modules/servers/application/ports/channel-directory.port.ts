/**
 * Channel Directory Port — what the servers module tells other modules about
 * where a channel is. The messaging module asks it on every message route,
 * which names only the channel (`/channels/{id}/messages`), to learn whose
 * permissions apply.
 *
 * Only the place: whether the person may see or post in it is the
 * permissions module's to answer (PERMISSION_CHECKER).
 */
export interface ChannelDirectoryPort {
    /** The server the channel is in; null when there is no such channel or its server was deleted. */
    serverIdOf(channelId: string): Promise<string | null>
}

export const CHANNEL_DIRECTORY = Symbol('ChannelDirectoryPort')
