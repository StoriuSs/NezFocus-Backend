import { Inject } from '@nestjs/common'
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import {
    INVITE_CODE_PATTERN,
    INVITE_REPOSITORY,
    InviteInvalidError,
    InviteListRow,
    InviteRepositoryPort,
    InviteTarget,
    inviteTarget,
    isLive
} from '../../../domain'
import { GUESS_LIMIT, GuessLimitPort, ICON_STORAGE, IconStoragePort } from '../../ports'
import { requireServerPermission } from '../../services/require-permission'
import { countingGuesses } from '../../services/invite-guesses'
import { ListInvitesQuery, PreviewInviteQuery } from './invite.queries'

/** The public invite page (S-SRV-03 › InviteCard). */
export interface InvitePreview {
    code: string
    server: { id: string; name: string; iconUrl: string | null; memberCount: number }
    /** Null when the creator has left or the account is deleted ("You're invited to", D-81). */
    inviterName: string | null
    channel: InviteTarget | null
}

@QueryHandler(ListInvitesQuery)
export class ListInvitesHandler implements IQueryHandler<ListInvitesQuery> {
    constructor(
        @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, serverId }: ListInvitesQuery): Promise<InviteListRow[]> {
        await requireServerPermission(this.checker, serverId, userId, 'MANAGE_SERVER')
        return this.invites.listLive(serverId, new Date())
    }
}

@QueryHandler(PreviewInviteQuery)
export class PreviewInviteHandler implements IQueryHandler<PreviewInviteQuery> {
    constructor(
        @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
        @Inject(ICON_STORAGE) private readonly storage: IconStoragePort,
        @Inject(GUESS_LIMIT) private readonly limit: GuessLimitPort
    ) {}

    /** Open to anyone: what is shown here is what the creator chose to send around. */
    async execute({ code, channelId, ip }: PreviewInviteQuery): Promise<InvitePreview> {
        return countingGuesses(this.limit, ip, async () => {
            const now = new Date()
            const found = INVITE_CODE_PATTERN.test(code) ? await this.invites.preview(code, channelId) : null
            if (!found || !isLive(found.invite, now)) throw new InviteInvalidError()
            const { server } = found
            return {
                code,
                server: {
                    id: server.id,
                    name: server.name,
                    iconUrl: server.iconKey ? await this.storage.getReadUrl(server.iconKey) : null,
                    memberCount: server.memberCount
                },
                inviterName: found.inviterName,
                channel: inviteTarget(server, found.channel, now)
            }
        })
    }
}

export const INVITE_QUERY_HANDLERS = [ListInvitesHandler, PreviewInviteHandler]
