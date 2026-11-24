/** What happened to a DM on one person's side (D-242, D-244). */
export type DmChange = 'created' | 'reopened' | 'closed'

/**
 * A DM was made, or opened again or closed on `userId`'s side, after
 * commit. Heard by this module's handler, which puts the sockets of a new
 * DM's two people in its room and tells `userId`'s tabs (`dm.created`,
 * `dm.updated`).
 */
export class DmChangedEvent {
    constructor(
        readonly userId: string,
        readonly channelId: string,
        readonly change: DmChange,
        /** The other one of the two. */
        readonly otherId: string
    ) {}
}
