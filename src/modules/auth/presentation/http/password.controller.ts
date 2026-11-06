import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { ApiEnvelopeResponse, CurrentUser, Public } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    ChangePasswordCommand,
    ForgotPasswordCommand,
    GetSignInMethodsQuery,
    IssuedSession,
    ResetPasswordCommand
} from '@/modules/auth/application'
import {
    ChangePasswordRequestDto,
    ForgotPasswordRequestDto,
    ResetPasswordRequestDto,
    SignInMethodsResponseDto,
    TokenResponseDto
} from './dto'
import { AuthCookies } from './auth-cookies'
import { accepted, client, clientIp, ok } from './route-helpers'

/**
 * Passwords: forgotten or changed; and how an account signs in
 * (docs/auth/api-reference.md).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class PasswordController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus,
        private readonly cookies: AuthCookies
    ) {}

    /** Email a code for choosing a new password. The answer is the same for any address. */
    @Public()
    @Post('forgot-password')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiEnvelopeResponse(null, HttpStatus.ACCEPTED)
    async forgotPassword(@Body() dto: ForgotPasswordRequestDto, @Req() req: Request): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new ForgotPasswordCommand(dto.email, clientIp(req), dto.language))
        return accepted(MESSAGES.AUTH.CODE_SENT_IF_ACCOUNT)
    }

    /**
     * Choose a new password with the emailed code. Ends every earlier session,
     * then signs in here: sets a new refresh cookie.
     */
    @Public()
    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TokenResponseDto)
    async resetPassword(
        @Body() dto: ResetPasswordRequestDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<TokenResponseDto>> {
        const session: IssuedSession = await this.commandBus.execute(
            new ResetPasswordCommand(dto.email, dto.code, dto.password, client(req), dto.language)
        )
        return this.cookies.signedIn(res, session, MESSAGES.AUTH.PASSWORD_RESET_SUCCESS)
    }

    /** Change the password, knowing the current one. Ends every other session. */
    @Post('change-password')
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth('bearer')
    @ApiEnvelopeResponse(null)
    async changePassword(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: ChangePasswordRequestDto
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(
            new ChangePasswordCommand(user.id, user.sessionId, dto.currentPassword, dto.newPassword, dto.language)
        )
        return createResponse(MESSAGES.AUTH.PASSWORD_CHANGED_SUCCESS, null)
    }

    /** How this account signs in: a password, other providers, or both. */
    @Get('sign-in-methods')
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth('bearer')
    @ApiEnvelopeResponse(SignInMethodsResponseDto)
    async signInMethods(@CurrentUser() user: AuthenticatedUser): Promise<ServiceResponse<SignInMethodsResponseDto>> {
        const methods: { password: boolean; providers: string[] } = await this.queryBus.execute(
            new GetSignInMethodsQuery(user.id)
        )
        return ok(validateAndTransform(SignInMethodsResponseDto, methods))
    }
}
