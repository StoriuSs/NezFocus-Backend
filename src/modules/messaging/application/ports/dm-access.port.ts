/** A direct message as messaging needs it (D-238): its two people, and when it began. */
export interface DmConversation {
    channelId: string
    /** The two people of the pair, smaller id first. */
    userIds: [string, string]
    /** Where each one's read state starts, as joining a server does for its channels (D-170). */
    createdAt: Date
}

/**
 * DM Access Port: what messaging asks of a direct message (D-238). Defined
 * here, answered by social through its global DmAccessModule: social owns
 * the conversations, friends and blocks, and imports this module, so this
 * one cannot import it. A DM is not a server's channel: its two people view
 * it, and the rule of who may message whom (REQ-SOCIAL-04) is social's, not
 * the permission algorithm (appendix B).
 */
export interface DmAccessPort {
    /** The DM `channelId`, or null when it is no DM. */
    conversation(channelId: string): Promise<DmConversation | null>
    /**
     * Whether `userId` may message the other one of the DM now: friends, or a
     * server shared with a recipient who lets server members write, and no
     * block either way (REQ-SOCIAL-04, D-242). False for anyone else.
     */
    canMessage(userId: string, channelId: string): Promise<boolean>
    /** The person's DMs shown in their list (D-244): never closed, or a message after they closed it. */
    shownOf(userId: string): Promise<DmConversation[]>
}

export const DM_ACCESS = Symbol('DmAccessPort')
