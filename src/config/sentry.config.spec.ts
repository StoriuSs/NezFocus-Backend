import { type ErrorEvent } from '@sentry/nestjs'
import { scrubEvent, sentryOptions } from './sentry.config'

const DSN = 'https://public@o1.ingest.us.sentry.io/2'

describe('error tracking', () => {
    it('sends no personal data and no local variables', () => {
        const options = sentryOptions({ NODE_ENV: 'production', SENTRY_DSN: DSN })
        expect(options).toMatchObject({ sendDefaultPii: false, includeLocalVariables: false })
    })

    it('removes credentials from the request, whatever their case or spelling', () => {
        const scrubbed = scrubEvent({
            type: undefined,
            request: {
                url: 'https://api.example.com/api/v1/users?token=abc&page=2',
                query_string: 'access_token=abc&page=2',
                cookies: { session: 's3cr3t' },
                headers: {
                    Authorization: 'Bearer eyJ',
                    'X-Api-Key': 'k',
                    'Idempotency-Key': 'i',
                    Cookie: 'session=s3cr3t',
                    'User-Agent': 'curl/8'
                },
                // As the SDK sends it: the raw body text.
                data: JSON.stringify({ username: 'alice', password: 'p', nested: { refresh_token: 'r', keep: 1 } })
            }
        } as ErrorEvent)
        expect(scrubbed.request).toEqual({
            url: 'https://api.example.com/api/v1/users?token=%5BREDACTED%5D&page=2',
            query_string: 'access_token=%5BREDACTED%5D&page=2',
            cookies: {},
            headers: {
                Authorization: '[REDACTED]',
                'X-Api-Key': '[REDACTED]',
                'Idempotency-Key': '[REDACTED]',
                Cookie: '[REDACTED]',
                'User-Agent': 'curl/8'
            },
            data: JSON.stringify({
                username: 'alice',
                password: '[REDACTED]',
                nested: { refresh_token: '[REDACTED]', keep: 1 }
            })
        })
    })
})
