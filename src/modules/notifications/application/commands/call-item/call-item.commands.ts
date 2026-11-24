/*
 * The items of missed calls (REQ-SOCIAL-06, D-120, D-242): written for the
 * callee the social module names after the call's message is written,
 * through NOTIFIER. They belong to no server: a DM's.
 */

/** Give `userId` a missed call item from `actorId`, naming the call's message in their DM. */
export class AddMissedCallItemCommand {
    constructor(
        readonly userId: string,
        readonly actorId: string,
        readonly channelId: string,
        readonly messageId: string
    ) {}
}
