import { randomInt } from 'crypto'
import { Inject, Logger } from '@nestjs/common'
import { CommandHandler, ICommandHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs'
import { Permission, PERMISSION_CHECKER, PermissionCheckerPort, serverPermissions } from '@/modules/permissions'
import {
    decideJoin,
    expiresAtFor,
    INVITE_CODE_PATTERN,
    InviteInvalidError,
    InviteRecord,
    InviteTarget,
    inviteTarget,
    isLive,
    isReusable,
    JoinDecision,
    MissingPermissionError,
    newInviteCode
} from '../../domain'
import {
    GUESS_LIMIT,
    GuessLimitPort,
    ICON_STORAGE,
    IconStoragePort,
    INVITE_REPOSITORY,
    InviteListRow,
    InviteRepositoryPort,
    SYSTEM_MESSAGES,
    SystemMessagesPort
} from '../ports'
import { requireServerPermission } from '../require-permission'
import { countingGuesses } from './invite-guesses'
import {
    AcceptInviteCommand,
    CreateInviteCommand,
    ListInvitesQuery,
    PreviewInviteQuery,
    RevokeInviteCommand
} from './invite.messages'

/** Tries at a code no link has yet; 57⁸ codes make a second try already rare. */
const CODE_ATTEMPTS = 3

/** The public invite page (S-SRV-03 › InviteCard). */
export interface InvitePreview {
    code: string
    server: { id: string; name: string; iconUrl: string | null; memberCount: number }
    /** Null when the creator has left or the account is deleted ("You're invited to", D-81). */
    inviterName: string | null
    channel: InviteTarget | null
}

@CommandHandler(CreateInviteCommand)
export class CreateInviteHandler implements ICommandHandler<CreateInviteCommand> {
    constructor(
        @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    async execute({ userId, serverId, settings }: CreateInviteCommand): Promise<InviteRecord> {
        await requireServerPermission(this.checker, serverId, userId, 'CREATE_INVITE')
        const now = new Date()

        if (settings.maxUses === null) {
            const own = await this.invites.latestOwnUnlimited(serverId, userId, settings.maxAgeSeconds)
            if (own && isReusable(own, settings, now)) return own
        }

        for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            const invite = {
                code: newInviteCode(randomInt),
                serverId,
                creatorId: userId,
                ...settings,
                expiresAt: expiresAtFor(settings.maxAgeSeconds, now)
            }
            if (await this.invites.insert(invite)) return { ...invite, uses: 0, createdAt: now }
        }
        throw new Error(`No free invite code after ${CODE_ATTEMPTS} attempts`)
    }
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

@CommandHandler(RevokeInviteCommand)
export class RevokeInviteHandler implements ICommandHandler<RevokeInviteCommand> {
    constructor(
        @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort
    ) {}

    /**
     * A link that no longer opens answers INVITE_INVALID, so the invites page
     * says "This invite has already expired" (S-SET-04). Someone outside the
     * server gets the same answer as for a code that does not exist: this
     * route must not tell which codes are real (the public page counts wrong
     * codes; this one need not, as it tells nothing).
     */
    async execute({ userId, code }: RevokeInviteCommand): Promise<void> {
        const now = new Date()
        const invite = await this.invites.find(code)
        if (!invite || !isLive(invite, now)) throw new InviteInvalidError()

        const access = await this.checker.access(invite.serverId, userId)
        if (!access) throw new InviteInvalidError()
        const own = invite.creatorId === userId
        const manages = (serverPermissions(access.server, access.member, now) & Permission.MANAGE_SERVER) !== 0n
        if (!own && !manages) throw new MissingPermissionError('MANAGE_SERVER')

        if (!(await this.invites.delete(code))) throw new InviteInvalidError()
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

@CommandHandler(AcceptInviteCommand)
export class AcceptInviteHandler implements ICommandHandler<AcceptInviteCommand> {
    private readonly logger = new Logger(AcceptInviteHandler.name)

    constructor(
        @Inject(INVITE_REPOSITORY) private readonly invites: InviteRepositoryPort,
        @Inject(GUESS_LIMIT) private readonly limit: GuessLimitPort,
        @Inject(SYSTEM_MESSAGES) private readonly messages: SystemMessagesPort
    ) {}

    /**
     * Joining adds no cache entry to clear: the permission cache never keeps
     * "not a member" (D-146), so the next check reads the new membership.
     *
     * The welcome message is posted after the commit; if that fails, they
     * have still joined, and are told so rather than shown an error (a retry
     * would only find them a member).
     */
    async execute({ userId, code, ip }: AcceptInviteCommand): Promise<{ serverId: string; decision: JoinDecision }> {
        const result = await countingGuesses(this.limit, ip, () => {
            if (!INVITE_CODE_PATTERN.test(code)) throw new InviteInvalidError()
            return this.invites.join(code, userId, decideJoin)
        })
        if (result.decision === 'join') {
            await this.messages.memberJoined(result.serverId, userId).catch((error: unknown) => {
                this.logger.error(`Welcome message not posted for server ${result.serverId}: ${String(error)}`)
            })
        }
        return result
    }
}

export const INVITE_HANDLERS = [
    CreateInviteHandler,
    ListInvitesHandler,
    RevokeInviteHandler,
    PreviewInviteHandler,
    AcceptInviteHandler
]
