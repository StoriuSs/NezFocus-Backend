import { ServerEdit } from '../../../domain'

/** PATCH /servers/{id} (S-SET-01): name and welcome channel. */
export class UpdateServerCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly edit: ServerEdit
    ) {}
}
