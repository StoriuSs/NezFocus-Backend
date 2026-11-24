import { CallEndedNotice, StudySessionNotice, TaskDueData } from '../../../domain'

/**
 * Post "<who> joined the server" in its welcome channel (REQ-SRV-01, D-83):
 * sent by servers through the SYSTEM_MESSAGES adapter (D-180), never by a route.
 */
export class PostMemberJoinedCommand {
    constructor(
        readonly serverId: string,
        readonly userId: string,
        readonly channelId: string
    ) {}
}

/**
 * Post "Còn 24 giờ tới hạn: {title} · {people}" in a task's channel
 * (REQ-TASK-04, MSG-08): sent by the tasks module through the bus when a
 * reminder's job runs, never by a route.
 */
export class PostTaskDueCommand {
    constructor(
        readonly serverId: string,
        readonly channelId: string,
        readonly due: TaskDueData
    ) {}
}

/**
 * Post that a study session started or ended in its room's chat
 * (REQ-MSG-08, D-222): sent by the study module through the bus after the
 * change is committed, never by a route.
 */
export class PostStudySessionCommand {
    constructor(
        readonly serverId: string,
        readonly channelId: string,
        readonly notice: StudySessionNotice
    ) {}
}

/**
 * Post that a call is over in its DM (REQ-MSG-08, D-106, D-242): sent by
 * the social module through the bus after the change is committed, never
 * by a route. A missed call names its callee: their inbox item, naming the
 * message, is written before the message is heard (L4-f).
 */
export class PostCallEndedCommand {
    constructor(
        readonly channelId: string,
        readonly notice: CallEndedNotice,
        /** The callee of a missed call (REQ-SOCIAL-06); null for any other end. */
        readonly missedCalleeId: string | null
    ) {}
}
