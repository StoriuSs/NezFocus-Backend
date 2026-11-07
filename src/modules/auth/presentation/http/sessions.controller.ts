import { Controller, Delete, Get, HttpCode, HttpStatus, Param } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    ListSessionsQuery,
    RevokeOtherSessionsCommand,
    RevokeSessionCommand,
    SessionSummary
} from '@/modules/auth/application'
import { RevokedSessionsResponseDto, SessionListResponseDto } from './dto'
import { ok } from './route-helpers'

/**
 * The signed-in devices of the account, and signing them out (REQ-AUTH-03,
 * D-75; docs/auth/api-reference.md). Signing out this device is
 * `POST /auth/logout`, beside the other routes of the refresh cookie.
 */
@ApiTags('auth')
@ApiBearerAuth('bearer')
@Controller({ path: 'auth/sessions', version: '1' })
export class SessionsController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus
    ) {}

    /** The live sessions: this device first, then by latest use. */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(SessionListResponseDto)
    async list(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<SessionListResponseDto>> {
        const sessions: SessionSummary[] = await this.queryBus.execute(new ListSessionsQuery(user.id, user.sessionId))
        return ok(validateAndTransform(SessionListResponseDto, { sessions }))
    }

    /**
     * "Sign out the other devices": every session but this one ends; they
     * learn why at their next request (`signed_out_everywhere`).
     */
    @Delete()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(RevokedSessionsResponseDto)
    async revokeOthers(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<RevokedSessionsResponseDto>> {
        const revoked: number = await this.commandBus.execute(new RevokeOtherSessionsCommand(user.id, user.sessionId))
        return createResponse(
            MESSAGES.AUTH.OTHER_SESSIONS_ENDED,
            validateAndTransform(RevokedSessionsResponseDto, { revoked })
        )
    }

    /**
     * Sign out one session (`revoked` at its next request). The same answer
     * when it already ended, or is not one of yours.
     */
    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RevokeSessionCommand(user.id, id))
        return createResponse(MESSAGES.AUTH.SESSION_ENDED, null)
    }
}
