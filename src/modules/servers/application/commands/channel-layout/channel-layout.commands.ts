import { ChannelDraft, ChannelEdit, LayoutMove } from '../../../domain'

/*
 * The changes to a server's categories and channels (REQ-SRV-02, S-SRV-05,
 * S-SET-05, S-SRV-06). Kept together: each is one line of intent around the
 * same transaction (ChangeLayout in channel-layout.handlers.ts), and the rules
 * all live in domain/channel-layout.ts.
 */

export class CreateCategoryCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly name: string
    ) {}
}

export class RenameCategoryCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly categoryId: string,
        public readonly name: string
    ) {}
}

export class DeleteCategoryCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly categoryId: string
    ) {}
}

export class CreateChannelCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly draft: ChannelDraft
    ) {}
}

export class UpdateChannelCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly channelId: string,
        public readonly edit: ChannelEdit
    ) {}
}

export class DeleteChannelCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly channelId: string
    ) {}
}

/** One drop in the channel list (D-149). */
export class MoveInLayoutCommand {
    constructor(
        public readonly userId: string,
        public readonly serverId: string,
        public readonly move: LayoutMove
    ) {}
}
