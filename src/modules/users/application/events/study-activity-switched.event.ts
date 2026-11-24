/**
 * Domain Event: Study Activity Switched
 *
 * Published when someone saves "Show study activity" (REQ-AUTH-07, D-79),
 * on or off, unchanged or not. The social module tells their friends and
 * servers their activity line again: none once it is off (D-247).
 */
export class StudyActivitySwitchedEvent {
    constructor(
        public readonly userId: string,
        /** As saved; for the log and tests: social reads the settings again, with the status chosen. */
        public readonly shown: boolean
    ) {}
}
