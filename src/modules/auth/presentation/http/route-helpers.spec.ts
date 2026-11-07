import { Request } from 'express'
import { client } from './route-helpers'

const requestWith = (userAgent: string | undefined, ip: string | undefined) =>
    ({ ip, get: (name: string) => (name === 'user-agent' ? userAgent : undefined) }) as unknown as Request

describe('client', () => {
    it('keeps a user agent of any real browser whole, and cuts one padded to kilobytes', () => {
        const chrome =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
        expect(client(requestWith(chrome, '203.0.113.7'))).toEqual({ ip: '203.0.113.7', userAgent: chrome })
        expect(client(requestWith(`${chrome}${'x'.repeat(8000)}`, '203.0.113.7')).userAgent).toHaveLength(512)
    })

    it('says so when the request has no address or no user agent', () => {
        expect(client(requestWith(undefined, undefined))).toEqual({ ip: 'unknown', userAgent: undefined })
    })
})
