import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { MESSAGES } from '@/shared/constants'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, createResponse, ServiceResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import { CloseDmCommand, DmView, GetDmQuery, ListMyDmsQuery, OpenDmCommand } from '../../application'
import { DmNotFoundError } from '../../domain'
import { DmIdParamsDto, DmListResponseDto, DmResponseDto, OpenDmRequestDto } from './dto'

/**
 * My direct messages (SRS 5.1, REQ-SOCIAL-04, D-242, D-244): the list,
 * opening one with someone, closing one on my side. Their messages, pins,
 * files and reads go through the channel routes, the DM's id as the
 * channel (D-238).
 */
@ApiTags('social')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class DmsController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** My DMs shown in my list, the latest active first: never closed, or a message after I closed it (D-244). */
    @Get('me/dms')
    @ApiEnvelopeResponse(DmListResponseDto)
    async list(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<DmListResponseDto>> {
        const dms: DmView[] = await this.queryBus.execute(new ListMyDmsQuery(user.id))
        return createResponse(MESSAGES.SOCIAL.DMS_LISTED, validateAndTransform(DmListResponseDto, { dms }))
    }

    /**
     * Open my DM with someone (D-242): the one there is, whatever stands
     * between us now, open again on my side; or a new one, for someone I
     * may message. Not found: oneself, no such account, one deleted or
     * waiting to be. CANNOT_MESSAGE_USER: every other reason, the same.
     */
    @Post('me/dms')
    @HttpCode(HttpStatus.OK)
    @Idempotent()
    @ApiEnvelopeResponse(DmResponseDto)
    async open(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: OpenDmRequestDto
    ): Promise<ServiceResponse<DmResponseDto>> {
        const { channelId }: { channelId: string } = await this.commandBus.execute(
            new OpenDmCommand(user.id, dto.userId)
        )
        // The answer is the DM as the list shows it, read by the list's query (D-159).
        const dm: DmView | null = await this.queryBus.execute(new GetDmQuery(user.id, channelId))
        if (!dm) throw new DmNotFoundError(channelId)
        return createResponse(MESSAGES.SOCIAL.DM_OPENED, validateAndTransform(DmResponseDto, dm))
    }

    /** Close a DM on my side (D-244): it leaves my list until a message comes; closed already, nothing changes. */
    @Delete('me/dms/:dmId')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async close(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { dmId }: DmIdParamsDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new CloseDmCommand(user.id, dmId))
        return createResponse(MESSAGES.SOCIAL.DM_CLOSED, null)
    }
}
