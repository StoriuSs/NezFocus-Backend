import { StudyCount } from '../../domain'

/**
 * A participation was counted (chốt, D-224), published after the commit of
 * the change that counted it: the person's tabs hear `streak.updated`.
 */
export class StudyCountedEvent {
    constructor(readonly count: StudyCount) {}
}
