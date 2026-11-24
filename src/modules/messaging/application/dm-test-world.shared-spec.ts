import { DmAccessPort, DmConversation } from './ports'

/** When the DMs below began: where their read state starts (D-244). */
export const DM_STARTED = new Date('2026-10-01T08:00:00Z')

/** What a test says of the DMs social would answer for. */
export interface DmWorld {
    /** The DMs there are, each with its two people. */
    conversations?: { channelId: string; userIds: [string, string] }[]
    /** Those who may no longer message the other one of their DMs (CANNOT_MESSAGE_USER). */
    silenced?: string[]
    /** The DMs shown in each person's list (D-244); every one of theirs when left out. */
    shown?: Record<string, string[]>
}

/**
 * Social's DM_ACCESS as an in-memory fake (D-238): `dms()` with no DMs for
 * the specs of a server's channels, which never reach it; with some for the
 * DM branch of each handler.
 */
export function dms({ conversations = [], silenced = [], shown }: DmWorld = {}): jest.Mocked<DmAccessPort> {
    const found = (channelId: string): DmConversation | null => {
        const conversation = conversations.find((one) => one.channelId === channelId)
        return conversation ? { ...conversation, createdAt: DM_STARTED } : null
    }
    return {
        conversation: jest.fn(async (channelId: string) => found(channelId)),
        canMessage: jest.fn(
            async (userId: string, channelId: string) =>
                !!found(channelId)?.userIds.includes(userId) && !silenced.includes(userId)
        ),
        shownOf: jest.fn(async (userId: string) =>
            conversations
                .filter((one) => one.userIds.includes(userId))
                .filter((one) => !shown || (shown[userId] ?? []).includes(one.channelId))
                .map((one) => ({ ...one, createdAt: DM_STARTED }))
        )
    }
}
