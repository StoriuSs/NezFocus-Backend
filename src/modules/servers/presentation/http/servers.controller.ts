import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    UploadedFile,
    UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { memoryStorage } from 'multer'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    CreateServerCommand,
    DeleteServerCommand,
    LeaveServerCommand,
    ListMyServersQuery,
    RemoveServerIconCommand,
    ServerListItem,
    TransferOwnershipCommand,
    UpdateServerCommand,
    UploadServerIconCommand
} from '../../application'
import { ICON_MAX_BYTES, ServerNotFoundError } from '../../domain'
import {
    CreateServerRequestDto,
    DeleteServerRequestDto,
    ServerIconResponseDto,
    ServerIdParamsDto,
    ServerListResponseDto,
    ServerResponseDto,
    TransferOwnershipRequestDto,
    UpdateServerRequestDto
} from './dto'
import { IconFilePipe } from './icon-file.pipe'
import { presentServer } from './server.presenter'

@ApiTags('servers')
@ApiBearerAuth('bearer')
@Controller({ path: 'servers', version: '1' })
export class ServersController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * Every server they are in, with the channels they may see and what they
     * may do there (D-115, D-145). The rail and the channel list read this.
     */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerListResponseDto)
    async list(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<ServerListResponseDto>> {
        const items: ServerListItem[] = await this.queryBus.execute(new ListMyServersQuery(user.id))
        return createResponse(
            MESSAGES.SERVER.LISTED,
            validateAndTransform(ServerListResponseDto, { servers: items.map(presentServer) })
        )
    }

    /**
     * A new server from a template (S-SRV-01). Answers with the server as the
     * list shows it, so the client adds it to the rail and opens its first
     * text channel without another request.
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiEnvelopeResponse(ServerResponseDto)
    @Idempotent()
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateServerRequestDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        const { serverId }: { serverId: string } = await this.commandBus.execute(
            new CreateServerCommand(user.id, dto.name, dto.template)
        )
        const [item]: ServerListItem[] = await this.queryBus.execute(new ListMyServersQuery(user.id, serverId))
        // Gone between creating and this read. Not reachable through the API
        // (M1 L9): deleting needs the id and the name typed again, and the id
        // is only known from this answer; an owner waiting to be deleted is
        // refused at every route. Were it reached, this 404 releases the
        // idempotency key and a retry would create a second server.
        if (!item) throw new ServerNotFoundError(serverId)
        return createResponse(MESSAGES.SERVER.CREATED, presentServer(item))
    }

    /**
     * Name and welcome channel (MANAGE_SERVER, S-SET-01). Answers with the
     * server as the list shows it, so the client swaps its copy in one go.
     */
    @Patch(':serverId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(ServerResponseDto)
    async update(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: UpdateServerRequestDto
    ): Promise<ServiceResponse<ServerResponseDto>> {
        await this.commandBus.execute(
            new UpdateServerCommand(user.id, serverId, { name: dto.name, welcomeChannelId: dto.welcomeChannelId })
        )
        const [item]: ServerListItem[] = await this.queryBus.execute(new ListMyServersQuery(user.id, serverId))
        // Gone between the change and this read (deleted, or they left).
        if (!item) throw new ServerNotFoundError(serverId)
        return createResponse(MESSAGES.SERVER.UPDATED, presentServer(item))
    }

    /** A new icon, cropped square by the client (MANAGE_SERVER). */
    @Post(':serverId/icon')
    @HttpCode(HttpStatus.OK)
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: { type: 'object', required: ['icon'], properties: { icon: { type: 'string', format: 'binary' } } }
    })
    @ApiEnvelopeResponse(ServerIconResponseDto)
    // A replay returns the presigned URL it first gave: keep it well inside
    // the URL's hour (as the avatar upload).
    @Idempotent('10m')
    @UseInterceptors(
        FileInterceptor('icon', {
            storage: memoryStorage(),
            // Refused while streaming, before it is buffered (413 UPLOAD_FILE_TOO_LARGE).
            limits: { fileSize: ICON_MAX_BYTES, files: 1 }
        })
    )
    async uploadIcon(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @UploadedFile(IconFilePipe) file: Express.Multer.File
    ): Promise<ServiceResponse<ServerIconResponseDto>> {
        const result: { iconUrl: string } = await this.commandBus.execute(
            new UploadServerIconCommand(user.id, serverId, file.buffer)
        )
        return createResponse(MESSAGES.SERVER.ICON_UPDATED, validateAndTransform(ServerIconResponseDto, result))
    }

    /**
     * Leave the server (S-SRV-04): any member but the owner, who hands it
     * over first (403 OWNER_CANNOT_LEAVE). Declared in this controller,
     * which ServersModule lists before ModerationController, so `me` is
     * never taken for a member id by DELETE …/members/:userId (kick).
     */
    @Delete(':serverId/members/me')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async leave(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new LeaveServerCommand(user.id, serverId))
        return createResponse(MESSAGES.SERVER.LEFT, null)
    }

    /**
     * Delete the server for every member (owner only, S-SET-07), its name
     * typed again. Its invites answer 410 INVITE_INVALID from now.
     */
    @Delete(':serverId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async remove(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: DeleteServerRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DeleteServerCommand(user.id, serverId, dto.name))
        return createResponse(MESSAGES.SERVER.DELETED, null)
    }

    /**
     * Hand the server to another member (owner only, S-SET-07), with the
     * owner's password. The old owner keeps their roles. The client reads the
     * server list again: what they may do has changed.
     */
    @Post(':serverId/transfer')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async transfer(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto,
        @Body() dto: TransferOwnershipRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new TransferOwnershipCommand(user.id, serverId, dto.userId, dto.password))
        return createResponse(MESSAGES.SERVER.TRANSFERRED, null)
    }

    /** Back to the initials (MANAGE_SERVER). */
    @Delete(':serverId/icon')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async removeIcon(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { serverId }: ServerIdParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RemoveServerIconCommand(user.id, serverId))
        return createResponse(MESSAGES.SERVER.ICON_REMOVED, null)
    }
}
