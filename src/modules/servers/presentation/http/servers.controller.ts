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
    ListMyServersQuery,
    RemoveServerIconCommand,
    ServerListItem,
    UpdateServerCommand,
    UploadServerIconCommand
} from '../../application'
import { ICON_MAX_BYTES, ServerNotFoundError } from '../../domain'
import {
    CreateServerRequestDto,
    ServerIconResponseDto,
    ServerIdParamsDto,
    ServerListResponseDto,
    ServerResponseDto,
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
