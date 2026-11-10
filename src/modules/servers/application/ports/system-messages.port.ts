/**
 * The system messages the server writes into a channel: "X joined the
 * server" in its welcome channel (REQ-SRV-01, D-83). Messages arrive in M2;
 * until then the adapter writes nothing, as M0 did with NoServersYet.
 */
export interface SystemMessagesPort {
    /** Called after the membership is committed. */
    memberJoined(serverId: string, userId: string): Promise<void>
}

export const SYSTEM_MESSAGES = Symbol('SystemMessagesPort')
