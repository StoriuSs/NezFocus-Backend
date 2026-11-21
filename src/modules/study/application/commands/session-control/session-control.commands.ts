import { ControlAction, Cycle } from '../../../domain'

/**
 * Pause, resume, skip the phase of, or stop a session (REQ-STUDY-03,
 * `POST /focus-sessions/{id}/pause|resume|skip|stop`), as its client saw it
 * at `version` (D-225).
 */
export class ControlFocusSessionCommand {
    constructor(
        readonly userId: string,
        readonly sessionId: string,
        readonly action: ControlAction,
        readonly version: number
    ) {}
}

/** A new cycle for a paused session (REQ-STUDY-03, D-50, `POST /focus-sessions/{id}/config`). */
export class ChangeFocusCycleCommand {
    constructor(
        readonly userId: string,
        readonly sessionId: string,
        readonly cycle: Cycle,
        readonly version: number
    ) {}
}
