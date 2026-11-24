import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { MESSAGES } from '@/shared/constants'
import { ApiEnvelopeResponse, CurrentUser, Idempotent } from '@/shared/presentation/decorators'
import { AuthenticatedUser, createResponse, ServiceResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import {
    AcceptCallCommand,
    CallView,
    DeclineCallCommand,
    EndCallCommand,
    GetCallQuery,
    GetMyCallQuery,
    MyCallsView,
    StartCallCommand
} from '../../application'
import { CallNotFoundError } from '../../domain'
import { CallIdParamsDto, CallResponseDto, DmIdParamsDto, MyCallResponseDto, StartCallRequestDto } from './dto'

/**
 * One-to-one calls (SRS 5.1, REQ-SOCIAL-05, ARCHITECTURE 6, D-242, D-245):
 * calling from a DM, answering, declining, hanging up, and my open calls on
 * reload. Each command answers with the call as it is after it, read by
 * GetCallQuery (D-159): one that came after the call changed (its caller
 * hung up, the other one ended it) answers it as it is, 200, its `status`
 * saying what became of it (D-245).
 */
@ApiTags('social')
@ApiBearerAuth('bearer')
@Controller({ version: '1' })
export class CallsController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /**
     * Call the other one of my DM: ringing, or `missed` at once (`busy`)
     * when they are in a call, ringing out, or rung by two already; the call
     * they make to me in this DM is answered (two calling each other meet in
     * one). CANNOT_MESSAGE_USER: someone I may not message, every reason the
     * same. CALL_IN_PROGRESS: me in another call already.
     */
    @Post('dms/:dmId/calls')
    @HttpCode(HttpStatus.CREATED)
    @Idempotent()
    @ApiEnvelopeResponse(CallResponseDto)
    async start(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { dmId }: DmIdParamsDto,
        @Body() dto: StartCallRequestDto
    ): Promise<ServiceResponse<CallResponseDto>> {
        const { callId }: { callId: string } = await this.commandBus.execute(
            new StartCallCommand(user.id, dmId, dto.video)
        )
        return createResponse(MESSAGES.SOCIAL.CALL_STARTED, await this.callOf(user.id, callId))
    }

    /** Answer a call ringing to me: the others ringing to me are missed as busy (D-120). */
    @Post('calls/:callId/accept')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(CallResponseDto)
    async accept(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { callId }: CallIdParamsDto
    ): Promise<ServiceResponse<CallResponseDto>> {
        await this.commandBus.execute(new AcceptCallCommand(user.id, callId))
        return createResponse(MESSAGES.SOCIAL.CALL_CHANGED, await this.callOf(user.id, callId))
    }

    /** Decline a call ringing to me: no inbox item for me (REQ-SOCIAL-06). */
    @Post('calls/:callId/decline')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(CallResponseDto)
    async decline(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { callId }: CallIdParamsDto
    ): Promise<ServiceResponse<CallResponseDto>> {
        await this.commandBus.execute(new DeclineCallCommand(user.id, callId))
        return createResponse(MESSAGES.SOCIAL.CALL_CHANGED, await this.callOf(user.id, callId))
    }

    /** Hang up: ringing, its caller cancels and its callee declines; active, it ends (D-242). */
    @Post('calls/:callId/end')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(CallResponseDto)
    async end(
        @CurrentUser() user: AuthenticatedUser,
        @Param() { callId }: CallIdParamsDto
    ): Promise<ServiceResponse<CallResponseDto>> {
        await this.commandBus.execute(new EndCallCommand(user.id, callId))
        return createResponse(MESSAGES.SOCIAL.CALL_CHANGED, await this.callOf(user.id, callId))
    }

    /** My open calls (D-245): the one I make or am in, and up to two ringing to me. */
    @Get('me/call')
    @ApiEnvelopeResponse(MyCallResponseDto)
    async mine(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<MyCallResponseDto>> {
        const calls: MyCallsView = await this.queryBus.execute(new GetMyCallQuery(user.id))
        return createResponse(MESSAGES.SOCIAL.CALLS_FETCHED, validateAndTransform(MyCallResponseDto, calls))
    }

    /** The call as I see it now, after a command on it (D-159). */
    private async callOf(userId: string, callId: string): Promise<CallResponseDto> {
        const call: CallView | null = await this.queryBus.execute(new GetCallQuery(userId, callId))
        if (!call) throw new CallNotFoundError(callId)
        return validateAndTransform(CallResponseDto, call)
    }
}
