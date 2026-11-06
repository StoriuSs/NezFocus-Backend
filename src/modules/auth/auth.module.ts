import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CqrsModule } from '@nestjs/cqrs'
import { QUEUES, registerQueues } from '@/shared/infrastructure/queue/queues'
import { EmailModule } from '@/shared/infrastructure/email/email.module'
import { RateLimiter } from '@/shared/infrastructure/rate-limit/rate-limiter'
import { UsersModule } from '@/modules/users/users.module'

// Application
import {
    AUTH_EVENTS,
    AUTH_MAILER,
    AUTH_SETTINGS,
    AuthSettings,
    ChangePasswordHandler,
    DeleteOwnAccountHandler,
    GetAuthOptionsHandler,
    GetSignInMethodsHandler,
    SendEmailCodeHandler,
    SignInMethods,
    SignInGate,
    CleanUpAuthHandler,
    CodeIssuer,
    EndSessionsOfDeletedAccountHandler,
    FinishOAuthHandler,
    ForgotPasswordHandler,
    LoginHandler,
    LogoutEverywhereHandler,
    LogoutHandler,
    OAUTH_PROVIDERS,
    OAUTH_SETTINGS,
    OAUTH_STATE,
    OAuthProviderPort,
    OAuthSettings,
    PASSWORD_HASHER,
    PRINCIPAL,
    RATE_LIMIT,
    RefreshCachedUserHandler,
    RefreshHandler,
    ResetPasswordHandler,
    SESSION_CACHE,
    SessionIssuer,
    StartOAuthHandler,
    TOKEN_SERVICE,
    VerifyEmailCodeHandler
} from './application'
import {
    CREDENTIAL_REPOSITORY,
    OAUTH_ACCOUNT_REPOSITORY,
    SESSION_REPOSITORY,
    VERIFICATION_CODE_REPOSITORY
} from '@/modules/auth/domain'

// Infrastructure
import {
    Argon2PasswordHasher,
    AuthEmails,
    BullMqAuthMailer,
    JoseTokenService,
    OpenIdConnectProvider,
    PrismaCredentialRepository,
    PrismaOAuthAccountRepository,
    PrismaSessionRepository,
    PrismaVerificationCodeRepository,
    PrometheusAuthEvents,
    RedisOAuthState,
    RedisSessionCache,
    TOKEN_KEYS,
    TokenKeys
} from './infrastructure'

// Presentation
import { AccessTokenGuard, AUTH_CONTROLLERS, AuthCookies, AuthJobsConsumer } from './presentation'

const CommandHandlers = [
    SendEmailCodeHandler,
    VerifyEmailCodeHandler,
    LoginHandler,
    RefreshHandler,
    LogoutHandler,
    LogoutEverywhereHandler,
    ForgotPasswordHandler,
    ResetPasswordHandler,
    ChangePasswordHandler,
    CleanUpAuthHandler,
    StartOAuthHandler,
    FinishOAuthHandler,
    DeleteOwnAccountHandler
]

const QueryHandlers = [GetSignInMethodsHandler, GetAuthOptionsHandler]

const EventHandlers = [EndSessionsOfDeletedAccountHandler, RefreshCachedUserHandler]

/**
 * Authentication, owned by the application (docs/auth/README.md).
 *
 * Depends on the users module through its published USER_DIRECTORY; the
 * users module knows nothing of this one. Exports the access-token guard,
 * which AppModule registers globally in the slot after the throttler.
 */
@Module({
    imports: [CqrsModule, UsersModule, EmailModule, registerQueues(QUEUES.AUTH)],
    // In an order that matters: OAuthController last (presentation/http/index.ts).
    controllers: AUTH_CONTROLLERS,
    providers: [
        {
            provide: AUTH_SETTINGS,
            inject: [ConfigService],
            useFactory: (config: ConfigService): AuthSettings => ({
                accessTokenTtlSeconds: config.get<number>('auth.accessTokenTtlSeconds')!,
                sessionTtlDays: config.get<number>('auth.sessionTtlDays')!,
                codeTtlMinutes: 10,
                codeMaxAttempts: 5,
                refreshGraceMs: 10_000
            })
        },
        {
            provide: TOKEN_KEYS,
            inject: [ConfigService],
            useFactory: (config: ConfigService): TokenKeys => ({
                secret: config.get<string>('auth.jwtSecret')!,
                issuer: config.get<string>('auth.issuer')!,
                audience: config.get<string>('auth.audience')!
            })
        },

        {
            provide: OAUTH_SETTINGS,
            inject: [ConfigService],
            useFactory: (config: ConfigService): OAuthSettings => ({
                callbackBaseUrl: config.get<string>('auth.oauthCallbackBaseUrl')!,
                attemptTtlSeconds: 600
            })
        },
        {
            // The providers configured in the environment. Google is any
            // OpenID Connect provider with Google's issuer; another one is an
            // entry here (docs/auth/google-sign-in.md, "Adding another provider").
            provide: OAUTH_PROVIDERS,
            inject: [ConfigService],
            useFactory: (config: ConfigService): OAuthProviderPort[] => {
                const providers: OAuthProviderPort[] = []
                const google = config.get<{ clientId: string; clientSecret: string }>('auth.google')!
                if (google.clientId && google.clientSecret) {
                    providers.push(
                        new OpenIdConnectProvider({
                            id: 'google',
                            displayName: 'Google',
                            issuer: 'https://accounts.google.com',
                            clientId: google.clientId,
                            clientSecret: google.clientSecret
                        })
                    )
                }
                return providers
            }
        },

        // Port → Adapter bindings
        { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
        { provide: TOKEN_SERVICE, useClass: JoseTokenService },
        { provide: CREDENTIAL_REPOSITORY, useClass: PrismaCredentialRepository },
        { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
        { provide: VERIFICATION_CODE_REPOSITORY, useClass: PrismaVerificationCodeRepository },
        { provide: OAUTH_ACCOUNT_REPOSITORY, useClass: PrismaOAuthAccountRepository },
        { provide: OAUTH_STATE, useClass: RedisOAuthState },
        { provide: AUTH_MAILER, useClass: BullMqAuthMailer },
        { provide: AUTH_EVENTS, useClass: PrometheusAuthEvents },
        // One class answers both: the guard's lookup and the handlers' invalidations.
        RedisSessionCache,
        { provide: PRINCIPAL, useExisting: RedisSessionCache },
        { provide: SESSION_CACHE, useExisting: RedisSessionCache },
        // The shared limiter (global CacheModule) satisfies the port as it is.
        { provide: RATE_LIMIT, useExisting: RateLimiter },

        // Application services
        SessionIssuer,
        CodeIssuer,
        SignInGate,
        SignInMethods,

        // CQRS
        ...CommandHandlers,
        ...QueryHandlers,
        ...EventHandlers,

        // The emails AuthJobsConsumer sends
        AuthEmails,

        // Inbound adapters
        AuthCookies,
        AccessTokenGuard,
        AuthJobsConsumer
    ],
    exports: [AccessTokenGuard]
})
export class AuthModule {}
