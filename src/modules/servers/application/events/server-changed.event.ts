/** What part of a server a change is about; each with its socket event (SRS 5.2). */
export type ServerTopic = 'server' | 'category' | 'channel' | 'role' | 'invite' | 'ban'
export type ServerAction = 'created' | 'updated' | 'deleted'

/** One kind of change, told once however many rows it wrote: `channel.updated` for a move of three channels. */
export interface ServerChange {
    topic: ServerTopic
    action: ServerAction
}

/**
 * Domain Event: Server Changed
 *
 * Published after the commit of any change to a server, its channel list,
 * its roles, its links or its ban list. The realtime module tells the
 * server's members, who each read the server again as they may see it
 * (D-178): the event names nothing but the server, so a private channel
 * says nothing of itself to those who may not view it.
 *
 * `viewChanged`: who may view which channel may have changed (a channel
 * made or deleted, made private or public, given other view roles; a role's
 * permissions or its going; the owner; a deleted server), so realtime moves
 * the members' sockets in or out of the channel rooms first (SRS 5.2). A
 * name, who may post, the order or a colour changes no view.
 *
 * Changes to one member (a role given, a timeout, joining, leaving) are
 * MemberChangedEvent.
 */
export class ServerChangedEvent {
    public readonly changes: ServerChange[]

    /** `changes` once each, in the order first written: a move of three channels is one `channel.updated`. */
    constructor(
        public readonly serverId: string,
        changes: ServerChange[],
        public readonly viewChanged: boolean
    ) {
        const seen = new Map<string, ServerChange>()
        for (const change of changes) {
            const key = `${change.topic}.${change.action}`
            if (!seen.has(key)) seen.set(key, change)
        }
        this.changes = [...seen.values()]
    }
}
