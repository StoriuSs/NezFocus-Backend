/**
 * The system messages the server writes into a channel: "X joined the
 * server" in its welcome channel (REQ-SRV-01, D-83). Answered by messaging,
 * which imports this module, through its global SystemMessagesModule (D-180).
 */
export interface SystemMessagesPort {
    /**
     * Called after the membership is committed, with the welcome channel read
     * as they joined; resolves once the message is written, so it is there
     * when they open the channel.
     */
    memberJoined(serverId: string, userId: string, channelId: string): Promise<void>
}

export const SYSTEM_MESSAGES = Symbol('SystemMessagesPort')
