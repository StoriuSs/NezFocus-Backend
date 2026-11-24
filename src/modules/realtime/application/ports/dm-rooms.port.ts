/**
 * DM Rooms Port — what this module offers social when a direct message is
 * made (D-242): the sockets of its two people join its room
 * (`channel:<id>`) at once, so its first message and typing reach them
 * without a reconnection. A socket that connects later joins it through
 * DM_CHANNELS. Reaches every app instance, as SOCKET_ROOMS does.
 */
export interface DmRoomsPort {
    /** Every socket of each of `userIds` into the DM's room. */
    join(channelId: string, userIds: string[]): Promise<void>
}

export const DM_ROOMS = Symbol('DmRoomsPort')
