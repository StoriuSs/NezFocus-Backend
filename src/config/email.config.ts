import { registerAs } from '@nestjs/config'
import { parseBooleanEnv, parseIntSafe } from '@/shared/utils'

/**
 * SMTP configuration.
 *
 * The shape here must match what email.module.ts reads. It previously did not:
 * the module asked for `email.secure`, `email.auth.user`, `email.auth.password`,
 * `email.from.name` and `email.from.address`, while this file exposed flat
 * `user` / `password` / `fromName` / `fromAddress` keys and no `secure` at all.
 * Only host and port ever resolved, so the transport would have been built with
 * no credentials and a From header reading `"undefined" <undefined>`.
 *
 * Nothing caught it while Keycloak (in the starter this one came from) sent
 * all the mail and the app's mailer had no callers. The auth module's codes are now its first.
 *
 * Deliberately provider-agnostic: any SMTP service (Brevo, Postmark, SES,
 * Mailgun, a local catcher) is a pure env change.
 */
export default registerAs('email', () => ({
    host: process.env.EMAIL_HOST || 'localhost',
    port: parseIntSafe(process.env.EMAIL_PORT, 587),
    // true for implicit TLS (port 465); false for STARTTLS (587) and for
    // plaintext local catchers.
    secure: parseBooleanEnv(process.env.EMAIL_SECURE),
    auth: {
        user: process.env.EMAIL_USER || '',
        password: process.env.EMAIL_PASSWORD || ''
    },
    from: {
        name: process.env.EMAIL_FROM_NAME || 'Test App',
        address: process.env.EMAIL_FROM_ADDRESS || 'noreply@testapp.com'
    }
}))
