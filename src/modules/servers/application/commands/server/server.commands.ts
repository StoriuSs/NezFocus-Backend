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
