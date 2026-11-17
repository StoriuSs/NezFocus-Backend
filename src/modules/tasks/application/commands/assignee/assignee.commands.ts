/*
 * The people on a task (REQ-TASK-02, S-TASK-02): adding them ("Thêm người",
 * "Tôi làm") and taking them off ("Rút khỏi việc này", the x on a row);
 * the app takes off those who left the server (REQ-TASK-04).
 */

export class AssignTaskCommand {
    constructor(
        public readonly userId: string,
        public readonly taskId: string,
        public readonly assigneeIds: string[]
    ) {}
}

export class UnassignTaskCommand {
    constructor(
        public readonly userId: string,
        public readonly taskId: string,
        public readonly assigneeId: string
    ) {}
}

/** Take a member who left the server off its tasks (REQ-TASK-04, D-195): run by the tasks queue. */
export class UnassignLeftMemberCommand {
    constructor(
        public readonly serverId: string,
        public readonly userId: string
    ) {}
}
