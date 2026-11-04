import { ipNetwork } from './ip-network.util'

describe('ipNetwork', () => {
    it('counts every address of one IPv6 /64 as one, and an IPv4 address in IPv6 form as that IPv4 address', () => {
        expect(ipNetwork('2001:db8:85a3:42::1')).toBe('2001:db8:85a3:42::/64')
        expect(ipNetwork('2001:0DB8:85A3:0042:ffff:1234:5678:9abc')).toBe('2001:db8:85a3:42::/64')
        expect(ipNetwork('2001:db8:85a3:43::1')).toBe('2001:db8:85a3:43::/64')
        // Not one network shared by every IPv4 client.
        expect(ipNetwork('::ffff:203.0.113.5')).toBe('203.0.113.5')
        expect(ipNetwork('::ffff:cb00:7105')).toBe('203.0.113.5')
        expect(ipNetwork('203.0.113.6')).toBe('203.0.113.6')
    })
})
