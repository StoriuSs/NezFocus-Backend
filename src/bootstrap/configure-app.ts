import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import * as path from 'path'
import { SnakeToCamelPipe, createValidationPipe } from '@/shared/presentation/pipes'
import { httpMetricsMiddleware, requestIdMiddleware } from '@/shared/presentation/middlewares'
import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'

/**
 * The HTTP pipeline every request goes through: proxy trust, middleware,
 * versioned routes under the prefix, CORS, cookies, security headers, uploads
 * and the global pipes. Shared by main.ts and the tests that boot the whole
 * app (test/integration/auth-http.integration-spec.ts), so those test the
 * pipeline production runs rather than a copy of it.
 */
export function configureApp(app: NestExpressApplication): void {
    const configService = app.get(ConfigService)

    // Behind Nginx (and Cloudflare). Trust the single reverse-proxy hop so
    // `req.ip` resolves to the real client IP — the rate limiter keys on it,
    // otherwise every anonymous request collapses into one bucket (Nginx's IP).
    app.set('trust proxy', 1)

    // First, so every response is covered — including requests outside the
    // global prefix, body-parser errors and 404s. Registered on Express rather
    // than through MiddlewareConsumer, which would apply the global prefix.
    app.use(requestIdMiddleware, httpMetricsMiddleware(app.get(MetricsService)))

    // Enable URI versioning (e.g., /api/v1/users)
    app.enableVersioning({
        type: 0, // VersioningType.URI
        defaultVersion: '1'
    })

    // Global prefix
    app.setGlobalPrefix(configService.get<string>('app.apiPrefix')!)

    // CORS
    app.enableCors({
        origin: configService.get<string[]>('cors.origins'),
        credentials: configService.get<boolean>('cors.credentials'),
        // A page on another origin can read only the response headers listed
        // here. Retry-After is how a 429 says how long to wait; without it the
        // frontend could only say "try again later".
        exposedHeaders: ['Retry-After']
    })

    // Cookie parser - must be before routes
    app.use(cookieParser())

    // Security - Helmet with custom CSP for images
    app.use(
        helmet({
            crossOriginResourcePolicy: { policy: 'cross-origin' },
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    imgSrc: ["'self'", 'data:', 'blob:', '*'],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"]
                }
            }
        })
    )

    // Serve locally stored uploads from the directory they are written to.
    // It was always cwd/uploads, so with UPLOAD_DEST=/data/uploads (a mounted
    // volume) uploads succeeded and every avatar URL answered 404.
    app.useStaticAssets(path.resolve(configService.get<string>('upload.local.uploadDir')!), {
        prefix: '/uploads/'
    })

    app.useGlobalPipes(
        new SnakeToCamelPipe(), // Convert snake_case to camelCase before validation
        createValidationPipe()
    )
}
