import { MetricsService } from '@/shared/infrastructure/monitoring/metrics.service'
import { reportError } from '@/shared/infrastructure/monitoring/error-reporting'
import { PrometheusAuthEvents } from './prometheus-auth-events.adapter'

jest.mock('@/shared/infrastructure/monitoring/error-reporting', () => ({ reportError: jest.fn() }))

describe('PrometheusAuthEvents', () => {
    const metrics = { recordAuthEvent: jest.fn() }
    const events = new PrometheusAuthEvents(metrics as unknown as MetricsService)

    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('reports a refresh token used twice to error tracking, with the user and session', () => {
        events.record('refresh_reuse_detected', { userId: 'user-1', sessionId: 'session-1' })

        expect(metrics.recordAuthEvent).toHaveBeenCalledWith('refresh_reuse_detected')
        expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
            userId: 'user-1',
            tags: { auth: 'refresh-reuse' },
            extra: { sessionId: 'session-1' }
        })
    })

    it('only counts an ordinary event', () => {
        events.record('login_succeeded')

        expect(metrics.recordAuthEvent).toHaveBeenCalledWith('login_succeeded')
        expect(reportError).not.toHaveBeenCalled()
    })
})
