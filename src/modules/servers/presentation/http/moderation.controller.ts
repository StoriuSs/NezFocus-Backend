import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { createPaginatedResponse, validateAndTransform } from '@/shared/utils'
import {
    BanMemberCommand,
    KickMemberCommand,
    ListBansQuery,
    TimeoutMemberCommand,
    UnbanMemberCommand
} from '../../application'
import { BanListItem } from '../../domain'
import {
    BanListQueryDto,
    BanPageResponseDto,
    ModerationReasonRequestDto,
    ServerIdParamsDto,
    ServerMemberParamsDto,
    TimeoutMemberRequestDto
} from './dto'

const BANS_PER_PAGE = 50

/**
 * Kick, ban, unban and timeout (REQ-ROLE-04, S-SET-03, S-SET-04). Changes
 * answer with no body: the client refetches the member list or the bans.
 */
@ApiTags('servers')
@ApiBearerAuth('bearer')
@Controller({ path: 'servers/:serverId', version: '1' })
export class ModerationController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** Out of the server, back in with a new invite (KICK_MEMBERS). */
    @Delete('members/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async kick(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, userId }: ServerMemberParamsDto,
        @Body() dto: ModerationReasonRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new KickMemberCommand(user.id, serverId, userId, dto.reason ?? null))
        return createResponse(MESSAGES.SERVER.MEMBER_KICKED, null)
    }

    /** Time out, give a running timeout a new length, or end it (MODERATE_MEMBERS). */
    @Patch('members/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async timeout(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, userId }: ServerMemberParamsDto,
        @Body() dto: TimeoutMemberRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(
            new TimeoutMemberCommand(user.id, serverId, userId, dto.timeoutSeconds, dto.reason ?? null)
        )
        return createResponse(MESSAGES.SERVER.MEMBER_TIMEOUT_CHANGED, null)
    }

    /** One page of the bans, newest first (BAN_MEMBERS). */
    @Get('bans')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(BanPageResponseDto)
    async bans(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Query() query: BanListQueryDto
    ): Promise<ServiceResponse<BanPageResponseDto>> {
        const page = query.page ?? 1
        const limit = query.limit ?? BANS_PER_PAGE
        const { items, total }: { items: BanListItem[]; total: number } = await this.queryBus.execute(
            new ListBansQuery(user.id, serverId, page, limit)
        )
        return createResponse(
            MESSAGES.SERVER.BANS_LISTED,
            validateAndTransform(BanPageResponseDto, createPaginatedResponse(items, page, limit, total))
        )
    }

    /** Out of the server and kept out (BAN_MEMBERS); only someone in it (D-155). */
    @Put('bans/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async ban(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, userId }: ServerMemberParamsDto,
        @Body() dto: ModerationReasonRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new BanMemberCommand(user.id, serverId, userId, dto.reason ?? null))
        return createResponse(MESSAGES.SERVER.MEMBER_BANNED, null)
    }

    @Delete('bans/:userId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async unban(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, userId }: ServerMemberParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new UnbanMemberCommand(user.id, serverId, userId))
        return createResponse(MESSAGES.SERVER.MEMBER_UNBANNED, null)
    }
}
