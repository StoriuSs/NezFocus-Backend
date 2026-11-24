import type { PairState, RelationshipWrite } from '../../domain'

/**
 * A pair's relationship or blocks changed (REQ-SOCIAL-01, REQ-SOCIAL-03),
 * after commit: `before` and `after` as `actorId` sees the pair. Heard by
 * this module's handlers, which tell each of the two what changed in their
 * list (`relationship.*`) and put the inbox items in or take them off.
 */
export class RelationshipChangedEvent {
    constructor(
        readonly actorId: string,
        readonly otherId: string,
        readonly before: PairState,
        readonly after: PairState,
        readonly write: Exclude<RelationshipWrite, { write: 'nothing' }>
    ) {}
}
