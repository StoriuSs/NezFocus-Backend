import { Module } from '@nestjs/common'
import { MailerModule } from '@nestjs-modules/mailer'
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { EmailService } from './email.service'

@Module({
    imports: [
        MailerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const emailConfig = {
                    host: config.get<string>('email.host'),
                    port: config.get<number>('email.port'),
                    secure: config.get<boolean>('email.secure'),
                    user: config.get<string>('email.auth.user'),
                    password: config.get<string>('email.auth.password'),
                    name: config.get<string>('email.from.name'),
                    address: config.get<string>('email.from.address')
                }

                return {
                    transport: {
                        host: emailConfig.host,
                        port: emailConfig.port,
                        secure: emailConfig.secure,
                        // No username, no login. An empty user and password
                        // still made nodemailer try AUTH PLAIN, and every send
                        // failed ("Missing credentials") against a server that
                        // takes mail without one — Mailpit, as .env.example
                        // sets it up, or a relay on a private network.
                        ...(emailConfig.user ? { auth: { user: emailConfig.user, pass: emailConfig.password } } : {}),
                        // Bounded, so an unreachable or stalled SMTP server
                        // fails the send instead of holding it for minutes
                        // (nodemailer's socket default is 10 minutes).
                        connectionTimeout: 10_000,
                        greetingTimeout: 10_000,
                        socketTimeout: 30_000
                    },
                    defaults: {
                        from: `"${emailConfig.name}" <${emailConfig.address}>`
                    },
                    // No template directory: each module's templates are beside
                    // its own code, and it passes their absolute path. The path
                    // is found from __dirname there, which works under ts-jest
                    // and compiled alike (nest-cli.json copies every module's
                    // templates into dist); choosing by NODE_ENV once looked in
                    // src/ for a compiled run, and the image has no src/.
                    template: {
                        adapter: new HandlebarsAdapter(),
                        options: {
                            strict: true
                        }
                    }
                }
            }
        })
    ],
    providers: [EmailService],
    exports: [EmailService]
})
export class EmailModule {}
