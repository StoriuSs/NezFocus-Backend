import { isIPv4, isIPv6 } from 'node:net'

const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i

/** The first two groups of an IPv6 address, however it is compressed: `2405::1` has 2405 and 0. */
function firstTwoGroups(address: string): string[] {
    const [head] = address.split('%')[0].split('::')
    const groups = head ? head.split(':') : []
    while (groups.length < 2) groups.push('0')
    return groups.slice(0, 2).map((group) => parseInt(group, 16).toString(16))
}

/**
 * An IP address as the list of sessions shows it (REQ-AUTH-03, D-138): the
 * network, not the household. IPv4 keeps its first two groups
 * (`14.231.x.x`), and so does IPv6 (`2405:4802:x:x…`); an IPv4 address
 * written as IPv6 (`::ffff:1.2.3.4`, how Node reports one on a dual-stack
 * socket) is IPv4. Masked here, so the full address never leaves the server.
 * Null for anything that is not an address (`unknown` when the request had none).
 */
export function maskIp(ip: string | null | undefined): string | null {
    if (!ip) return null
    const address = MAPPED_IPV4.exec(ip)?.[1] ?? ip
    if (isIPv4(address)) {
        const [a, b] = address.split('.')
        return `${a}.${b}.x.x`
    }
    if (isIPv6(address)) return `${firstTwoGroups(address).join(':')}:x:x…`
    return null
}
