// First: some config is read at import time — see load-env.ts.
import './config/load-env'
// Second: error tracking, before the modules it instruments are loaded.
import './instrument'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { Logger } from 'nestjs-pino'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { mountApiDocs, mountQueueDashboard } from './bootstrap/operational-endpoints'
import { configureApp } from './bootstrap/configure-app'
import { getQueueToken } from '@nestjs/bullmq'
import { QUEUES } from '@/shared/infrastructure/queue/queues'
import { AppLogger } from '@/shared/infrastructure/logging/app-logger'

async function bootstrap() {
    // bufferLogs: Nest's own startup logs (module and route registration, or a
    // failure to start) wait for the pino logger installed below. Without it
    // they went out as coloured plain text around the JSON logs.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })

    // Use Pino logger FIRST - this ensures proper log ordering. AppLogger keeps
    // the error in `logger.error(message, error)` calls, which pino drops.
    app.useLogger(app.get(AppLogger))

    // Middleware, routes, CORS, cookies, headers, pipes: src/bootstrap/configure-app.ts
    configureApp(app)

    const configService = app.get(ConfigService)
    const apiPrefix = configService.get<string>('app.apiPrefix')!

    // Operational endpoints on raw Express, outside every Nest guard. The
    // credentials are validated in src/config/validation.ts: in production a
    // missing or default password refuses to boot.
    const nodeEnv = configService.get<string>('app.nodeEnv')
    const opsCredentials = {
        user: configService.get<string>('app.bullBoardUser')!,
        password: configService.get<string>('app.bullBoardPassword')!
    }

    // OpenAPI docs, generated from the code at boot. Public in development,
    // behind basic auth in production.
    mountApiDocs(app, configService.get<string>('app.name')!, nodeEnv === 'production' ? opsCredentials : null)

    mountQueueDashboard(
        app,
        Object.values(QUEUES).map((name) => app.get(getQueueToken(name))),
        opsCredentials
    )

    // Start server
    const port = configService.get<number>('app.port')
    // In Docker the app listens on a fixed internal port that differs from the
    // host port, so links are built from BASE_URL (the address you actually open).
    const baseUrl = configService.get<string>('app.baseUrl')

    // Graceful shutdown on SIGTERM/SIGINT: stop the HTTP server, let in-flight
    // requests finish, then close connections (onApplicationShutdown hooks).
    app.enableShutdownHooks()

    await app.listen(port!)

    // Through the logger, one entry: a console.log banner spanned lines around
    // the JSON logs. pino-pretty shows the fields when running in a terminal.
    const logger = app.get(Logger)
    logger.log(
        {
            msg: 'Application is running',
            environment: nodeEnv,
            url: baseUrl,
            api: `${baseUrl}/${apiPrefix}/v1`,
            apiDocs: `${baseUrl}/api-docs`,
            queueDashboard: `${baseUrl}/admin/queues`
        },
        'Bootstrap'
    )

    // once: after shutting down, Nest sends the signal to the process again,
    // which logged the line twice.
    process.once('SIGTERM', () => logger.log('SIGTERM received, shutting down gracefully', 'Bootstrap'))
    process.once('SIGINT', () => logger.log('SIGINT received, shutting down gracefully', 'Bootstrap'))
}

bootstrap()
