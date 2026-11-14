import { ReadStateView } from '../services/read-states'

/** How far someone has read a channel changed (REQ-MSG-09): their other tabs and devices follow. */
export class ReadStateUpdatedEvent {
    constructor(
        readonly userId: string,
        readonly state: ReadStateView
    ) {}
}
