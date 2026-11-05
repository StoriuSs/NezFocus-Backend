import pino from 'pino'
import { REDACT_PATHS, resolveLogFormat } from './pino.config'

describe('resolveLogFormat', () => {
    it('is JSON wherever Alloy may read the output, and pretty where only a person does', () => {
        expect(resolveLogFormat({}, false)).toBe('json') // a container
        expect(resolveLogFormat({ MONITORING: 'local' }, false)).toBe('json')
        expect(resolveLogFormat({ MONITORING: 'grafana-cloud' }, false)).toBe('json')
        expect(resolveLogFormat({ MONITORING: 'off' }, false)).toBe('pretty')
        expect(resolveLogFormat({}, true)).toBe('pretty') // a terminal
    })

    it('obeys LOG_FORMAT, except in production, which is always JSON', () => {
        expect(resolveLogFormat({ MONITORING: 'off', LOG_FORMAT: 'json' }, true)).toBe('json')
        expect(resolveLogFormat({ LOG_FORMAT: 'pretty' }, false)).toBe('pretty')
        expect(resolveLogFormat({ NODE_ENV: 'production', MONITORING: 'off', LOG_FORMAT: 'pretty' }, true)).toBe('json')
    })
})

describe('REDACT_PATHS', () => {
    it('are paths pino accepts, and it censors credentials in headers and body fields with them', () => {
        const lines: string[] = []
        const log = pino(
            { redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } },
            { write: (line: string) => lines.push(line) }
        )
        log.info({
            req: {
                headers: { authorization: 'Bearer x', cookie: 'refresh_token=r', accept: '*/*' },
                body: { password: 'p', code: '123456', refresh_token: 'r', email: 'a@example.test' }
            },
            res: { headers: { 'set-cookie': 's' } }
        })
        const logged = JSON.parse(lines[0])
        expect(logged.req.headers).toEqual({ authorization: '[REDACTED]', cookie: '[REDACTED]', accept: '*/*' })
        expect(logged.req.body).toEqual({
            password: '[REDACTED]',
            code: '[REDACTED]',
            refresh_token: '[REDACTED]',
            email: 'a@example.test'
        })
        expect(logged.res.headers['set-cookie']).toBe('[REDACTED]')
    })
})
