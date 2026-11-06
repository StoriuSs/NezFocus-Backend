import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { DeleteOwnAccountCommand } from '@/modules/auth/application'
import { DeleteAccountRequestDto } from './dto'
import { AuthCookies } from './auth-cookies'

/**
 * Deleting your own account (docs/account-deletion.md). Here rather than in
 * the users module: it takes proof it is you (the password), and ends every
 * session.
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
     * Delete your own account, with the password as proof it is you. Every
     * session ends, this one included; the owner is emailed.
     */
    @Post('delete')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async delete(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: DeleteAccountRequestDto,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new DeleteOwnAccountCommand(user.id, { password: dto.password }, dto.language))
        this.cookies.clearRefresh(res)
        return createResponse(MESSAGES.USER.ACCOUNT_DELETED, null)
    }
}
