/**
 * Someone came into voice room `channelId` (voice's VoiceStateChangedEvent,
 * ARCHITECTURE 5.2): they take part in its session, if it has one.
 */
export class JoinStudyRoomCommand {
    constructor(
        readonly channelId: string,
        readonly userId: string
    ) {}
}

/**
 * Someone went out of voice room `channelId` (VoiceStateChangedEvent):
 * `lost`, their connection was lost, so they are away 3 minutes (D-215);
 * else they left, or were made to. `channelId` null: they asked to leave
 * whichever room they are in (VoiceLeaveRequestedEvent, D-228), at
 * `requestedAt` (now when not given): a place opened since, in the room
 * they went on to, stays open (M5 L9).
 */
export class LeaveStudyRoomCommand {
    constructor(
        readonly channelId: string | null,
        readonly userId: string,
        readonly lost: boolean,
        readonly requestedAt: Date | null = null
    ) {}
}
