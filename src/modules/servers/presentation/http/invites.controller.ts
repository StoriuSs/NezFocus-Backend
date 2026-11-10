import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { Request } from 'express'
import { ApiEnvelopeResponse, CurrentUser, Idempotent, Public } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    AcceptInviteCommand,
    CreateInviteCommand,
    InviteListRow,
    InvitePreview,
    ListInvitesQuery,
    ListMyServersQuery,
    PreviewInviteQuery,
    RevokeInviteCommand,
    ServerListItem
} from '../../application'
import { InviteRecord, JoinDecision, ServerNotFoundError } from '../../domain'
import {
    AcceptInviteResponseDto,
    CreateInviteRequestDto,
    InviteCodeParamsDto,
    InviteListResponseDto,
    InvitePreviewQueryDto,
    InvitePreviewResponseDto,
    InviteResponseDto,
    ServerIdParamsDto
} from './dto'
import { presentServer } from './server.presenter'

/** The address wrong codes are counted against (REQ-SRV-03); behind the proxy, as trust proxy resolves it. */
const clientIp = (req: Request) => req.ip ?? 'unknown'

/** Invite links (REQ-SRV-03, SRV-04): S-SRV-02, S-SRV-03, S-SET-04. */
@ApiTags('invites')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class InvitesController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * A link to send (CREATE_INVITE): their own again when it has the same
     * lifetime, no limit on uses and half its time left; a new one otherwise
     * (D-151).
     */
    @Post('servers/:serverId/invites')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(InviteResponseDto)
    @Idempotent()
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: CreateInviteRequestDto
    ): Promise<ServiceResponse<InviteResponseDto>> {
        const invite: InviteRecord = await this.commandBus.execute(
            new CreateInviteCommand(user.id, serverId, { maxAgeSeconds: dto.maxAgeSeconds, maxUses: dto.maxUses })
        )
        return createResponse(MESSAGES.SERVER.INVITE_CREATED, validateAndTransform(InviteResponseDto, invite))
    }

    /** The server's links that still open, newest first (MANAGE_SERVER, S-SET-04). */
    @Get('servers/:serverId/invites')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(InviteListResponseDto)
    async list(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto
    ): Promise<ServiceResponse<InviteListResponseDto>> {
        const invites: InviteListRow[] = await this.queryBus.execute(new ListInvitesQuery(user.id, serverId))
        return createResponse(MESSAGES.SERVER.INVITES_LISTED, validateAndTransform(InviteListResponseDto, { invites }))
    }

    /**
     * The invite page, open to anyone (S-SRV-03). INVITE_INVALID (410) for a
     * link that no longer opens; more than 30 wrong codes a minute from one
     * network: RATE_LIMIT_EXCEEDED.
     */
    @Public()
    @Get('invites/:code')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(InvitePreviewResponseDto)
    async preview(
        @Req() req: Request,
        @Param() { code }: InviteCodeParamsDto,
        @Query() { channel }: InvitePreviewQueryDto
    ): Promise<ServiceResponse<InvitePreviewResponseDto>> {
        const preview: InvitePreview = await this.queryBus.execute(
            new PreviewInviteQuery(code, channel ?? null, clientIp(req))
        )
        return createResponse(MESSAGES.SERVER.INVITE_FOUND, validateAndTransform(InvitePreviewResponseDto, preview))
    }

    /** Stop a link opening: its creator, or anyone with MANAGE_SERVER. */
    @Delete('invites/:code')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async revoke(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { code }: InviteCodeParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RevokeInviteCommand(user.id, code))
        return createResponse(MESSAGES.SERVER.INVITE_REVOKED, null)
    }

    /**
     * Join the server (REQ-SRV-04). A member is answered with the server as
     * well, `joined: false`, and no use counted. The client opens the link's
     * `?channel=` when it is among the channels it now sees, else the first
     * text channel.
     */
    @Post('invites/:code/accept')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(AcceptInviteResponseDto)
    async accept(
        @Req() req: Request,
        @CurrentUser() user: AuthenticatedUser,
        @Param() { code }: InviteCodeParamsDto
    ): Promise<ServiceResponse<AcceptInviteResponseDto>> {
        const { serverId, decision }: { serverId: string; decision: JoinDecision } = await this.commandBus.execute(
            new AcceptInviteCommand(user.id, code, clientIp(req))
        )
        const [item]: ServerListItem[] = await this.queryBus.execute(new ListMyServersQuery(user.id, serverId))
        // Gone between joining and this read (deleted, or banned meanwhile).
        if (!item) throw new ServerNotFoundError(serverId)
        return createResponse(MESSAGES.SERVER.INVITE_ACCEPTED, {
            server: presentServer(item),
            joined: decision === 'join'
        })
    }
}
