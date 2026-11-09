import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    CreateCategoryCommand,
    CreateChannelCommand,
    DeleteCategoryCommand,
    DeleteChannelCommand,
    ListMyServersQuery,
    MoveInLayoutCommand,
    RenameCategoryCommand,
    ServerListItem,
    UpdateChannelCommand
} from '../../application'
import { LayoutMove, ServerNotFoundError } from '../../domain'
import {
    CategoryNameRequestDto,
    CreateChannelRequestDto,
    CreatedInServerResponseDto,
    MoveInLayoutRequestDto,
    ServerCategoryParamsDto,
    ServerChannelParamsDto,
    ServerIdParamsDto,
    ServerResponseDto,
    UpdateChannelRequestDto
} from './dto'
import { presentServer } from './server.presenter'

/**
 * Categories and channels of a server (REQ-SRV-02; S-SRV-05, S-SET-05,
 * S-SRV-06). Each answers with the server as the caller now sees it, so the
 * client swaps its copy in one go, positions and permissions included, with
 * no second request (until M2 the list changes for others when they reload
 * or come back to the tab, D-143).
 */
@ApiTags('servers')
@ApiBearerAuth('bearer')
@Controller({ path: 'servers/:serverId', version: '1' })
export class ChannelLayoutController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** A category at the end of the list (MANAGE_CHANNELS). */
    @Post('categories')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(CreatedInServerResponseDto)
    @Idempotent()
    async createCategory(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: CategoryNameRequestDto
    ): Promise<ServiceResponse<CreatedInServerResponseDto>> {
        const { categoryId }: { categoryId: string } = await this.commandBus.execute(
            new CreateCategoryCommand(user.id, serverId, dto.name)
        )
        return createResponse(MESSAGES.SERVER.CATEGORY_CREATED, await this.created(user.id, serverId, categoryId))
    }

    @Patch('categories/:categoryId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerResponseDto)
    async renameCategory(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, categoryId }: ServerCategoryParamsDto,
        @Body() dto: CategoryNameRequestDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        await this.commandBus.execute(new RenameCategoryCommand(user.id, serverId, categoryId, dto.name))
        return createResponse(MESSAGES.SERVER.CATEGORY_UPDATED, await this.view(user.id, serverId))
    }

    /** Its channels move above the first category (REQ-SRV-02). */
    @Delete('categories/:categoryId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerResponseDto)
    async deleteCategory(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, categoryId }: ServerCategoryParamsDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        await this.commandBus.execute(new DeleteCategoryCommand(user.id, serverId, categoryId))
        return createResponse(MESSAGES.SERVER.CATEGORY_DELETED, await this.view(user.id, serverId))
    }

    /** A text channel or a room at the end of its group (MANAGE_CHANNELS). */
    @Post('channels')
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(CreatedInServerResponseDto)
    @Idempotent()
    async createChannel(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: CreateChannelRequestDto
    ): Promise<ServiceResponse<CreatedInServerResponseDto>> {
        const { channelId }: { channelId: string } = await this.commandBus.execute(
            new CreateChannelCommand(user.id, serverId, {
                type: dto.type,
                name: dto.name,
                categoryId: dto.categoryId ?? null,
                isStudyRoom: dto.isStudyRoom ?? false,
                isPrivate: dto.isPrivate ?? false,
                viewRoleIds: dto.viewRoleIds ?? []
            })
        )
        return createResponse(MESSAGES.SERVER.CHANNEL_CREATED, await this.created(user.id, serverId, channelId))
    }

    /** One drop (D-149). Declared before channels/:channelId, which would take "order" for an id. */
    @Patch('channels/order')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerResponseDto)
    async move(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: MoveInLayoutRequestDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        const move: LayoutMove =
            dto.kind === 'channel'
                ? { kind: 'channel', id: dto.id, categoryId: dto.categoryId ?? null, afterId: dto.afterId }
                : { kind: 'category', id: dto.id, afterId: dto.afterId }
        await this.commandBus.execute(new MoveInLayoutCommand(user.id, serverId, move))
        return createResponse(MESSAGES.SERVER.LAYOUT_MOVED, await this.view(user.id, serverId))
    }

    @Patch('channels/:channelId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerResponseDto)
    async updateChannel(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, channelId }: ServerChannelParamsDto,
        @Body() dto: UpdateChannelRequestDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        const { name, sendMode, isPrivate, viewRoleIds } = dto
        await this.commandBus.execute(
            new UpdateChannelCommand(user.id, serverId, channelId, { name, sendMode, isPrivate, viewRoleIds })
        )
        return createResponse(MESSAGES.SERVER.CHANNEL_UPDATED, await this.view(user.id, serverId))
    }

    @Delete('channels/:channelId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerResponseDto)
    async deleteChannel(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId, channelId }: ServerChannelParamsDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        await this.commandBus.execute(new DeleteChannelCommand(user.id, serverId, channelId))
        return createResponse(MESSAGES.SERVER.CHANNEL_DELETED, await this.view(user.id, serverId))
    }

    private async view(userId: string, serverId: string): Promise<ServerResponseDto> {
        const [item]: ServerListItem[] = await this.queryBus.execute(new ListMyServersQuery(userId, serverId))
        // Gone between the change and this read (deleted, or they left).
        if (!item) throw new ServerNotFoundError(serverId)
        return presentServer(item)
    }

    private async created(userId: string, serverId: string, id: string): Promise<CreatedInServerResponseDto> {
        return validateAndTransform(CreatedInServerResponseDto, { id, server: await this.view(userId, serverId) })
    }
}
