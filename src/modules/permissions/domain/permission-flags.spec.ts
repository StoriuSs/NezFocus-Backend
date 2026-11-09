import { ALL_PERMISSIONS, fromWire, hasPermission, Permission, toWire } from './permission-flags'

describe('permission bits on the wire', () => {
    it('round-trips every permission through a decimal string', () => {
        expect(fromWire(toWire(ALL_PERMISSIONS))).toBe(ALL_PERMISSIONS)
    })

    it.each([
        ['an empty string', ''],
        ['a negative number', '-1'],
        ['a hex number', '0x10'],
        ['a fraction', '1.5'],
        ['far too many digits', '9'.repeat(21)]
    ])('reads %s as no permissions', (_title, wire) => {
        expect(fromWire(wire)).toBe(0n)
    })

    it('drops bits that are not permissions', () => {
        expect(fromWire(String((1n << 9n) | (1n << 40n) | Permission.SPEAK))).toBe(Permission.SPEAK)
    })
})

describe('hasPermission', () => {
    it('needs every bit asked for', () => {
        const granted = Permission.SEND_MESSAGES | Permission.SPEAK
        expect(hasPermission(granted, Permission.SPEAK)).toBe(true)
        expect(hasPermission(granted, Permission.SPEAK | Permission.VIDEO)).toBe(false)
    })
})
