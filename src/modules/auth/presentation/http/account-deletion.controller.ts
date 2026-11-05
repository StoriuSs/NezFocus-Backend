import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { DeleteOwnAccountCommand, SendAccountDeletionCodeCommand } from '@/modules/auth/application'
import { DeleteAccountRequestDto } from './dto'
import { AuthCookies } from './auth-cookies'
import { clientIp, ok } from './route-helpers'

/**
 * Deleting your own account (docs/account-deletion.md). Here rather than in
 * the users module: it takes proof it is you (the password or an emailed
 * code), and ends every session.
 */
@ApiTags('auth')
@ApiBearerAuth('bearer')
@Controller({ path: 'auth/account', version: '1' })
export class AccountDeletionController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly cookies: AuthCookies
    ) {}

    /**
     * For deleting an account made with Google, which has no password to
     * confirm with: email a code. 409 AUTH_USE_PASSWORD for one with a password.
     */
    @Post('delete-code')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async sendCode(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new SendAccountDeletionCodeCommand(user.id))
        return ok(null)
    }

    /**
     * Delete your own account, with proof it is you: the password (or the
     * emailed code, for an account without one). Every session ends, this one included; the owner is emailed.
     */
    @Post('delete')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async delete(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: DeleteAccountRequestDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(
            new DeleteOwnAccountCommand(user.id, { password: dto.password, code: dto.code }, clientIp(req))
        )
        this.cookies.clearRefresh(res)
        return createResponse(MESSAGES.USER.ACCOUNT_DELETED, null)
    }
}
