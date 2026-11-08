import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { AllowPendingDeletion, ApiEnvelopeResponse, CurrentUser } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { validateAndTransform } from '@/shared/utils'
import { MESSAGES } from '@/shared/constants'
import { DeleteOwnAccountCommand, RestoreAccountCommand } from '@/modules/auth/application'
import { AccountDeletionResponseDto, DeleteAccountRequestDto } from './dto'
import { AuthCookies } from './auth-cookies'

/**
 * Deleting your own account, and taking it back (docs/account-deletion.md).
 * Here rather than in the users module: it takes proof it is you (the
 * password, or having just signed in), and ends every session.
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
     * Ask to delete your own account, with the password as proof it is you.
     * It is deleted 14 days later unless you sign in and restore it (D-141).
     * Every session ends, this one included; the owner is emailed the date.
     */
    @Post('delete')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(AccountDeletionResponseDto)
    async delete(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: DeleteAccountRequestDto,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<AccountDeletionResponseDto>> {
        const deletesAt: Date = await this.commandBus.execute(
            new DeleteOwnAccountCommand(user.id, dto.password, dto.language)
        )
        this.cookies.clearRefresh(res)
        return createResponse(
            MESSAGES.USER.ACCOUNT_DELETION_REQUESTED,
            validateAndTransform(AccountDeletionResponseDto, { deletesAt })
        )
    }

    /**
     * Restore an account waiting to be deleted: for the dialog shown after
     * signing in to one. The only route such an account may use besides
     * `GET /users/me`. Restoring one that is not waiting changes nothing.
     */
    @Post('restore')
    @AllowPendingDeletion()
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(null)
    async restore(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new RestoreAccountCommand(user.id))
        return createResponse(MESSAGES.USER.ACCOUNT_RESTORED, null)
    }
}
