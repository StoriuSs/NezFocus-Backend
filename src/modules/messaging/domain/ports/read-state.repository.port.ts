/** How far one person has read one channel, and what is still new to them there (REQ-MSG-09). */
export interface ChannelReadState {
    channelId: string
    /** The last message read: the later of the one they marked and where they joined (D-170). */
    lastReadId: string
    /**
     * Live messages after it not from them (sent by them, or a system message
     * about them), system ones included, counted up to READ_COUNT_CAP (D-173).
     */
    unreadCount: number
    /** Those of them about the person (D-39, D-164, D-172), counted up to READ_COUNT_CAP. */
    mentionCount: number
}

/** A channel to read the state of, and where the person stands in it if they never marked it. */
export interface ReadScope {
    channelId: string
    /** readFloor of when they joined its server (D-170). */
    floorId: string
}

/**
 * Read State Repository Port — the ReadState rows, and the counts worked out
 * from them when read (D-164).
 */
export interface ReadStateRepositoryPort {
    /** Moves the person's last read message in the channel to `messageId`, never back (D-173). */
    markRead(userId: string, channelId: string, messageId: string): Promise<void>

    /**
     * The person's state in channels of one server, in the order given.
     * `roleIds`: the roles they hold there, for @role mentions.
     */
    states(userId: string, roleIds: string[], channels: ReadScope[]): Promise<ChannelReadState[]>
}

export const READ_STATE_REPOSITORY = Symbol('ReadStateRepositoryPort')
