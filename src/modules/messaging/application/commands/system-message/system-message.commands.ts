import { TaskDueData } from '../../../domain'

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
