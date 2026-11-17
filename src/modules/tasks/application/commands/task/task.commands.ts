import { TaskDraft, TaskEdit } from '../../../domain'

/*
 * Making, changing and deleting tasks on a Task Board (REQ-TASK-01 to 03,
 * S-TASK-01 to 03). Kept together: each is one line of intent around the
 * same steps (services/change-task.ts), and the rules all live in
 * domain/task.rules.ts.
 */

export class CreateTaskCommand {
    constructor(
        public readonly userId: string,
        public readonly channelId: string,
        public readonly draft: TaskDraft
    ) {}
}

/** "Sửa việc" and the status control: only what is sent changes. */
export class UpdateTaskCommand {
    constructor(
        public readonly userId: string,
        public readonly taskId: string,
        public readonly edit: TaskEdit
    ) {}
}

export class DeleteTaskCommand {
    constructor(
        public readonly userId: string,
        public readonly taskId: string
    ) {}
}
