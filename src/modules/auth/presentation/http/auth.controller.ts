import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { ApiEnvelopeResponse, CurrentUser, Public } from '@/shared/presentation/decorators'
import { AuthenticatedUser, ServiceResponse, createResponse } from '@/shared/types'
import { MESSAGES } from '@/shared/constants'
import { validateAndTransform } from '@/shared/utils'
import {
    AuthOptions,
    DEFAULT_EMAIL_LANGUAGE,
    EmailCodeSignIn,
    GetAuthOptionsQuery,
    IssuedSession,
    LoginCommand,
    LogoutCommand,
    LogoutEverywhereCommand,
    RefreshCommand,
    SendEmailCodeCommand,
    VerifyEmailCodeCommand
} from '@/modules/auth/application'
import {
    AuthOptionsResponseDto,
    EmailCodeRequestDto,
    EmailCodeSignInResponseDto,
    LoginRequestDto,
    TokenResponseDto,
    VerifyEmailCodeRequestDto
} from './dto'
import { AuthCookies } from './auth-cookies'
import { accepted, client, clientIp, ok } from './route-helpers'

/**
 * Creating an account and signing in, by code or password, and sessions
 * (docs/auth/api-reference.md). The other
 * /auth routes are in the controllers beside this one: passwords, deleting
 * the account, and other providers.
 *
 * The access token goes back in the body and the refresh token in an httpOnly
 * cookie scoped to /auth (auth-cookies.ts).
 */
@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
    constructor(
        private readonly commandBus: CommandBus,
        private readonly queryBus: QueryBus,
        private readonly cookies: AuthCookies
    ) {}

    /**
     * Email a sign-in code: the first step of creating an account and of
     * signing in with a code (D-59, D-60). Sending again is the same call.
     * The answer is the same for any address, with an account or not.
     */
    @Public()
    @Post('email-code')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiEnvelopeResponse(null, HttpStatus.ACCEPTED)
    async sendEmailCode(@Body() dto: EmailCodeRequestDto, @Req() req: Request): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(
            new SendEmailCodeCommand(dto.email, dto.language ?? DEFAULT_EMAIL_LANGUAGE, clientIp(req))
        )
        return accepted(MESSAGES.AUTH.CODE_SENT)
    }

    /**
     * Sign in with the emailed code, making the account if the address has
     * none. Sets the refresh cookie. `account.completed` false: the account
     * must be completed before anything else (D-61).
     */
    @Public()
    @Post('email-code/verify')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(EmailCodeSignInResponseDto)
    async verifyEmailCode(
        @Body() dto: VerifyEmailCodeRequestDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<EmailCodeSignInResponseDto>> {
        const signedIn: EmailCodeSignIn = await this.commandBus.execute(
            new VerifyEmailCodeCommand(dto.email, dto.code, client(req))
        )
        this.cookies.setRefresh(res, signedIn.session)
        const body = validateAndTransform(EmailCodeSignInResponseDto, {
            accessToken: signedIn.session.accessToken,
            tokenType: 'Bearer',
            expiresIn: signedIn.session.expiresInSeconds,
            account: signedIn.account
        })
        return createResponse(MESSAGES.AUTH.CODE_SIGN_IN_SUCCESS, body)
    }

    /** Sign in. Sets the refresh cookie. */
    @Public()
    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(TokenResponseDto)
    async login(
        @Body() dto: LoginRequestDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<TokenResponseDto>> {
        const session: IssuedSession = await this.commandBus.execute(
            new LoginCommand(dto.email, dto.password, client(req))
        )
        return this.cookies.signedIn(res, session, MESSAGES.AUTH.LOGIN_SUCCESS)
    }

    /** A new access token, from the refresh cookie. Replaces the cookie too: each is used once. */
    @Public()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiCookieAuth('refresh_token')
    @ApiEnvelopeResponse(TokenResponseDto)
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<TokenResponseDto>> {
        this.cookies.assertAllowedOrigin(req)
        try {
            const session: IssuedSession = await this.commandBus.execute(
                new RefreshCommand(this.cookies.readRefresh(req))
            )
            return this.cookies.signedIn(res, session, MESSAGES.AUTH.TOKEN_REFRESHED)
        } catch (error) {
            // A cookie that no longer works is only in the way.
            this.cookies.clearRefresh(res)
            throw error
        }
    }

    /** End this session. Always succeeds, and clears the cookie. */
    @Public()
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    @ApiCookieAuth('refresh_token')
    @ApiEnvelopeResponse(null)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<ServiceResponse<null>> {
        this.cookies.assertAllowedOrigin(req)
        await this.commandBus.execute(new LogoutCommand(this.cookies.readRefresh(req)))
        this.cookies.clearRefresh(res)
        return createResponse(MESSAGES.AUTH.LOGOUT_SUCCESS, null)
    }

    /** End every session of the signed-in user, this one included. */
    @Post('logout-all')
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth('bearer')
    @ApiEnvelopeResponse(null)
    async logoutEverywhere(
        @CurrentUser() user: AuthenticatedUser,
        @Res({ passthrough: true }) res: Response
    ): Promise<ServiceResponse<null>> {
        await this.commandBus.execute(new LogoutEverywhereCommand(user.id))
        this.cookies.clearRefresh(res)
        return createResponse(MESSAGES.AUTH.LOGOUT_EVERYWHERE_SUCCESS, null)
    }

    /**
     * What the sign-in pages need to know: the other providers configured
     * (`google`).
     */
    @Public()
    @Get('options')
    @HttpCode(HttpStatus.OK)
    @ApiEnvelopeResponse(AuthOptionsResponseDto)
    async authOptions(): Promise<ServiceResponse<AuthOptionsResponseDto>> {
        const options: AuthOptions = await this.queryBus.execute(new GetAuthOptionsQuery())
        return ok(validateAndTransform(AuthOptionsResponseDto, options))
    }
}
