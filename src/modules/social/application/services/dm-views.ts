import type { LastMessage, LastMessagesPort } from '@/modules/messaging'
import { Presence, PresencePort } from '@/modules/realtime'
import { DmEntry, isShownDm } from '../../domain'
import { reachOf, ReachSources } from './dm-reach'
import { PersonView, personViews } from './relationship-views'

/** A DM as one of its two sees it (`GET /me/dms`, D-244): the other one, what they may do, the last message. */
export interface DmView {
    /** The DM's channel: its messages go through the channel routes (D-238). */
    id: string
    user: PersonView
    /**
     * What I see of them when their presence reaches me anyway: a friend, or
     * someone I share a server with (D-242); null for anyone else, and for an
     * account gone.
     */
    presence: Presence | null
    /** Whether I may message them now (REQ-SOCIAL-04): the composer and the call button follow it. */
    canMessage: boolean
    /** The last message not deleted, for the row's second line; null in a DM with none. */
    lastMessage: LastMessage | null
    createdAt: Date
}

/** What DM views read: who may be messaged, presence, pictures, last messages. */
export interface DmViewSources extends ReachSources {
    presence: PresencePort
    lastMessages: LastMessagesPort
}

/** When a DM last had something: its last message, or its making. */
const activeAt = (view: DmView): number => (view.lastMessage?.createdAt ?? view.createdAt).getTime()

/**
 * The entries as `userId` sees them, in the order given; with `shownOnly`,
 * only those shown in their list (isShownDm, D-244), the latest active
 * first (spec 09 Q5: a new message brings its DM to the top): the last
 * messages read first, so a DM not shown costs nothing more. One read of
 * each kind for them all.
 */
export async function dmViews(
    sources: DmViewSources,
    userId: string,
    entries: DmEntry[],
    shownOnly = false
): Promise<DmView[]> {
    if (entries.length === 0) return []
    const last = await sources.lastMessages.lastMessagesOf(entries.map((entry) => entry.channelId))
    const lastOf = new Map(last.map((message) => [message.channelId, message]))
    if (shownOnly) {
        entries = entries.filter((entry) => isShownDm(entry.closedAt, lastOf.get(entry.channelId)?.createdAt ?? null))
        if (entries.length === 0) return []
    }
    const recipients = entries.map((entry) => ({ id: entry.other.id, gone: entry.otherGone }))
    const [reach, shown, people] = await Promise.all([
        reachOf(sources, userId, recipients),
        sources.presence.everyoneShown(),
        personViews(
            sources.users,
            entries.map((entry) => entry.other)
        )
    ])
    const seen = new Set([...reach.sharing, ...reach.friends])
    const views = entries.map((entry, index): DmView => {
        const otherId = entry.other.id
        return {
            id: entry.channelId,
            user: people[index]!,
            presence: !entry.otherGone && seen.has(otherId) ? (shown.get(otherId) ?? 'offline') : null,
            canMessage: reach.messageable.has(otherId),
            lastMessage: lastOf.get(entry.channelId) ?? null,
            createdAt: entry.createdAt
        }
    })
    return shownOnly ? views.sort((a, b) => activeAt(b) - activeAt(a)) : views
}
