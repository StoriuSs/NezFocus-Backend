/*
 * The people on a task (REQ-TASK-02, S-TASK-02): adding them ("Thêm người",
 * "Tôi làm") and taking them off ("Rút khỏi việc này", the x on a row).
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
