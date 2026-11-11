import { ServerEdit, ServerTemplateName } from '../../../domain'

export class CreateServerCommand {
    constructor(
        public readonly userId: string,
        /** Already composed and trimmed. */
        public readonly name: string,
        public readonly template: ServerTemplateName
    ) {}
}

/** PATCH /servers/{id} (S-SET-01): name and welcome channel. */
export class UpdateServerCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly edit: ServerEdit
    ) {}
}

export class UploadServerIconCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly file: Buffer
    ) {}
}

export class RemoveServerIconCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

/** DELETE /servers/{id}/members/me (S-SRV-04 `leave-confirm`). */
export class LeaveServerCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

/** DELETE /servers/{id} (S-SET-07 `delete-type-name`): the owner types its name again. */
export class DeleteServerCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly typedName: string
    ) {}
}

/** POST /servers/{id}/transfer (S-SET-07 `transfer-password`). */
export class TransferOwnershipCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly toUserId: string,
        public readonly password: string
    ) {}
}

/** What a deleted account leaves in one server (D-76): run for AccountDeletedEvent and by the clean-up. */
export class ForgetDeletedMemberCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string
    ) {}
}

/**
 * Run daily by src/maintenance: deletes for good the servers deleted 30 days
 * ago, and finishes what a lost AccountDeletedEvent left behind.
 */
export class CleanUpServersCommand {
    constructor(public readonly now: Date) {}
}
