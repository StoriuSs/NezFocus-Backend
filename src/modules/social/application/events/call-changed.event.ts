import type { CallRecord, CallStatus } from '../../domain'

/**
 * A call was made or changed (ARCHITECTURE 6, D-242), after commit: as it
 * is now, and its status before (null: made now). Heard by this module's
 * handlers, which tell the two people's tabs (`call.*`) and, once it is
 * over, write its system message in the DM and the missed call's inbox item.
 */
export class CallChangedEvent {
    constructor(
        readonly call: CallRecord,
        readonly before: CallStatus | null
    ) {}
}
