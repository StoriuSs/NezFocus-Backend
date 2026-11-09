/**
 * The permission bits of SRS appendix B. A role holds a set of them as one
 * number, OR-ed together; `BigInt` because a plain number stops being exact
 * past 2^53 and bitwise operators on it work on 32 bits only.
 *
 * A bit's number is stored in every role row, so it never changes meaning:
 * bit 9 (READ_MESSAGE_HISTORY, dropped in D-47) stays unused.
 */
export const Permission = {
    /** Every permission, still bound by the role hierarchy. */
    ADMINISTRATOR: 1n << 0n,
    MANAGE_SERVER: 1n << 1n,
    MANAGE_ROLES: 1n << 2n,
    MANAGE_CHANNELS: 1n << 3n,
    KICK_MEMBERS: 1n << 4n,
    BAN_MEMBERS: 1n << 5n,
    /** Time members out. */
    MODERATE_MEMBERS: 1n << 6n,
    CREATE_INVITE: 1n << 7n,
    /** See a channel and read all of it, old messages included. */
    VIEW_CHANNEL: 1n << 8n,
    SEND_MESSAGES: 1n << 10n,
    ATTACH_FILES: 1n << 11n,
    ADD_REACTIONS: 1n << 12n,
    MENTION_EVERYONE: 1n << 13n,
    /** Delete others' messages, pin, post in managers-only channels. */
    MANAGE_MESSAGES: 1n << 14n,
    CONNECT: 1n << 15n,
    SPEAK: 1n << 16n,
    VIDEO: 1n << 17n,
    MUTE_MEMBERS: 1n << 18n,
    MOVE_MEMBERS: 1n << 19n,
    MANAGE_STUDY_ROOMS: 1n << 20n,
    CREATE_TASKS: 1n << 21n,
    MANAGE_TASKS: 1n << 22n
} as const

export type PermissionName = keyof typeof Permission

export const ALL_PERMISSIONS = Object.values(Permission).reduce((all, bit) => all | bit, 0n)

/** What @everyone starts with in a new server (appendix B, last column). */
export const EVERYONE_DEFAULT_PERMISSIONS =
    Permission.CREATE_INVITE |
    Permission.VIEW_CHANNEL |
    Permission.SEND_MESSAGES |
    Permission.ATTACH_FILES |
    Permission.ADD_REACTIONS |
    Permission.CONNECT |
    Permission.SPEAK |
    Permission.VIDEO |
    Permission.CREATE_TASKS

export const hasPermission = (granted: bigint, permission: bigint) => (granted & permission) === permission

/**
 * Bits as JSON carries them: a decimal string, since JSON has no BigInt and a
 * number would lose the high bits (D-145).
 */
export const toWire = (bits: bigint) => bits.toString()

/** Anything that is not a set of known bits reads as none. */
export function fromWire(wire: string): bigint {
    if (!/^\d{1,20}$/.test(wire)) return 0n
    return BigInt(wire) & ALL_PERMISSIONS
}
