import { maskIp } from './masked-ip'

describe('maskIp (D-138)', () => {
    it('keeps the first two groups of an IPv4 address', () => {
        expect(maskIp('14.231.162.5')).toBe('14.231.x.x')
        expect(maskIp('203.0.113.7')).toBe('203.0.x.x')
    })

    it('reads an IPv4 address mapped into IPv6 as IPv4', () => {
        expect(maskIp('::ffff:113.190.42.9')).toBe('113.190.x.x')
        expect(maskIp('::FFFF:113.190.42.9')).toBe('113.190.x.x')
    })

    it('keeps the first two groups of an IPv6 address, whatever is compressed', () => {
        expect(maskIp('2405:4802:1d2:a0b0:c4d1:1234:5678:9abc')).toBe('2405:4802:x:x…')
        // Lower case and no leading zeros, however it was written.
        expect(maskIp('2405:04A2::1')).toBe('2405:4a2:x:x…')
        // The second group is inside the "::".
        expect(maskIp('2405::1')).toBe('2405:0:x:x…')
        expect(maskIp('::1')).toBe('0:0:x:x…')
        // A zone index is not part of the address.
        expect(maskIp('fe80::1%eth0')).toBe('fe80:0:x:x…')
    })

    it('shows nothing for what is not an address', () => {
        expect(maskIp(undefined)).toBeNull()
        expect(maskIp(null)).toBeNull()
        expect(maskIp('')).toBeNull()
        expect(maskIp('unknown')).toBeNull()
        expect(maskIp('1.2.3')).toBeNull()
    })
})
