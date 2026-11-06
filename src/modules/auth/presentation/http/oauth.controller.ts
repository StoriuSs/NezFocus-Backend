import { Controller, Get, HttpStatus, Logger, Param, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus } from '@nestjs/cqrs'
import { ApiFoundResponse, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { Request, Response } from 'express'
import { Public } from '@/shared/presentation/decorators'
import { OAuthProviderUnknownError, OAuthSignInError } from '@/modules/auth/domain'
import { FinishOAuthCommand, OAuthFinished, OAuthStarted, StartOAuthCommand } from '@/modules/auth/application'
import { AuthCookies } from './auth-cookies'
import { client } from './route-helpers'

/**
 * Signing in with another provider (Google): browser navigations, not API
 * calls, so both routes answer with redirects (docs/auth/google-sign-in.md).
 *
 * `auth/:provider` matches any `GET /auth/<word>`, so this controller is
 * registered after every other one with GET routes under /auth (AUTH_CONTROLLERS
 * in ./index.ts): Express takes the first route that matches.
 */
@ApiTags('auth')
@Public()
@Controller({ path: 'auth', version: '1' })
export class OAuthController {
    private readonly logger = new Logger(OAuthController.name)
    private readonly frontendUrl: string

    constructor(
        private readonly commandBus: CommandBus,
        private readonly cookies: AuthCookies,
        config: ConfigService
    ) {
        this.frontendUrl = config.get<string>('app.frontendUrl')!
    }

    /**
     * Sign in with another provider. Redirects to the provider, and sets a
     * short-lived cookie that ties its return to this browser.
     */
    @Get(':provider')
    @ApiParam({ name: 'provider', example: 'google' })
    @ApiQuery({ name: 'redirect', required: false, description: 'A path of the web app to return to. Default `/`.' })
    @ApiFoundResponse({ description: 'To the provider' })
    async start(@Param('provider') provider: string, @Req() req: Request, @Res() res: Response): Promise<void> {
        const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : undefined
        const started: OAuthStarted = await this.commandBus.execute(new StartOAuthCommand(provider, redirect))
        this.cookies.setOAuthState(res, provider, started.state)
        res.redirect(HttpStatus.FOUND, started.authorizationUrl)
    }

    /**
     * Where the provider sends the browser back. Signs in and redirects to the
     * web app's `/auth/callback?redirect=<path>`; if it cannot, to
     * `/auth/callback?error=cancelled|failed|email_unverified|account_deleted`.
     */
    @Get(':provider/callback')
    @ApiParam({ name: 'provider', example: 'google' })
    @ApiFoundResponse({ description: 'To the web app' })
    async finish(@Param('provider') provider: string, @Req() req: Request, @Res() res: Response): Promise<void> {
        const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : ''
        let target: string
        try {
            const finished: OAuthFinished = await this.commandBus.execute(
                new FinishOAuthCommand(provider, query, this.cookies.readOAuthState(req), client(req))
            )
            this.cookies.setRefresh(res, finished.session)
            target = this.webApp({ redirect: finished.redirect })
        } catch (error) {
            if (error instanceof OAuthSignInError) {
                this.logger.warn(`${provider} sign-in did not complete (${error.reason}): ${error.detail}`)
                target = this.webApp({ error: error.reason, redirect: error.redirect })
            } else if (error instanceof OAuthProviderUnknownError) {
                throw error
            } else {
                // Unexpected (the database, Redis): the browser still goes
                // back to the app, which says it did not work.
                this.logger.error(`${provider} sign-in failed: ${(error as Error).message}`, (error as Error).stack)
                target = this.webApp({ error: 'failed' })
            }
        }
        this.cookies.clearOAuthState(res, provider)
        res.redirect(HttpStatus.FOUND, target)
    }

    /** The web app's callback page, with the parameters that have a value. */
    private webApp(params: Record<string, string | undefined>): string {
        const present = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))
        return `${this.frontendUrl}/auth/callback?${new URLSearchParams(present)}`
    }
}
