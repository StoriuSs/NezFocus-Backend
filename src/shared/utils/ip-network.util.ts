import { isIPv4, isIPv6 } from 'net'

/**
 * The unit a per-IP limit counts: an IPv4 address, or an IPv6 /64 network.
 *
 * An IPv6 connection — a home router, a phone, a rented server — is handed a
 * whole /64: eighteen billion billion addresses, any of which it can use for
 * the next request. Counting full IPv6 addresses therefore limits nothing; the
 * /64 is what one customer gets, so it is what is counted. An IPv4 address
 * written the IPv6 way (`::ffff:203.0.113.5`, as a dual-stack socket reports
 * it) is that IPv4 address, not a share of `::ffff:0:0/64` with every other
 * IPv4 client.
 *
 * Anything else (not an IP at all) comes back unchanged.
 */
export function ipNetwork(ip: string): string {
    const address = ip.split('%')[0] // a zone (fe80::1%eth0) is local to this host
    if (!isIPv6(address)) return ip
    const groups = expandIPv6(address)
    const mappedIPv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
    if (mappedIPv4) return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.')
    return `${groups
        .slice(0, 4)
        .map((group) => group.toString(16))
        .join(':')}::/64`
}

/** The eight 16-bit groups of a valid IPv6 address, `::` and a dotted IPv4 tail written out. */
function expandIPv6(address: string): number[] {
    let text = address.toLowerCase()
    const lastColon = text.lastIndexOf(':')
    const tail = text.slice(lastColon + 1)
    if (isIPv4(tail)) {
        const [a, b, c, d] = tail.split('.').map(Number)
        text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    }
    const [head, rest] = text.split('::')
    const parse = (part: string | undefined) => (part ? part.split(':').map((group) => parseInt(group, 16)) : [])
    const before = parse(head)
    const after = parse(rest)
    if (rest === undefined) return before
    return [...before, ...Array<number>(8 - before.length - after.length).fill(0), ...after]
}
