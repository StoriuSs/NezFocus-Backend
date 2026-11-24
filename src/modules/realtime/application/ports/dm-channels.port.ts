/**
 * DM Channels Port — the direct messages a person is in (D-242), whose
 * rooms (`channel:<id>`) their sockets join when they connect, closed ones
 * too: a new message there reaches them and shows it again (D-244).
 * Defined here, answered by the social module through its global
 * DmChannelsModule: the code depends one way only, social on realtime.
 */
export interface DmChannelsPort {
    /** The channel ids of the person's DMs. */
    channelIdsOf(userId: string): Promise<string[]>
}

export const DM_CHANNELS = Symbol('DmChannelsPort')
