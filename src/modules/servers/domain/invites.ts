import { AccessChannel, AccessMember, AccessRole, channelPermissions, Permission } from '@/modules/permissions'
import { BannedFromServerError, InviteInvalidError, MaxServersReachedError } from './errors'
import { MAX_SERVERS_PER_USER } from './server-limit.rules'

/** The lifetimes a link may have, in seconds (REQ-SRV-03): 30 minutes, 1 hour, 1 day, 7 days. Null: never expires. */
export const INVITE_MAX_AGES = [30 * 60, 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60] as const

/** The most uses a link may be limited to (REQ-SRV-03). Null: no limit. */
export const INVITE_MAX_USES = 100

/** What the API takes as a code: 8–10 letters and digits (REQ-SRV-03). */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9]{8,10}$/

/**
 * Letters and digits, without the ones read alike (0 O o, 1 l I), for
 * someone typing a code off a phone. 57⁸ codes: guessing one at 30 wrong
 * codes a minute (the limit per network) is hopeless.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const CODE_LENGTH = 8

/** A new code; `pick(n)` is a uniform random integer in [0, n), from a secure source. */
export function newInviteCode(pick: (below: number) => number): string {
    return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('')
}

export interface InviteSettings {
    /** The lifetime chosen (one of INVITE_MAX_AGES); null: never expires. */
    maxAgeSeconds: number | null
    /** 1–100; null: no limit. */
    maxUses: number | null
}

export interface InviteRecord extends InviteSettings {
    code: string
    serverId: string
    creatorId: string
    uses: number
    expiresAt: Date | null
    createdAt: Date
}

export function expiresAtFor(maxAgeSeconds: number | null, now: Date): Date | null {
    return maxAgeSeconds === null ? null : new Date(now.getTime() + maxAgeSeconds * 1000)
}

/** Still opens: within its time and its uses. */
export function isLive(invite: Pick<InviteRecord, 'uses' | 'maxUses' | 'expiresAt'>, now: Date): boolean {
    const inTime = invite.expiresAt === null || invite.expiresAt.getTime() > now.getTime()
    const usesLeft = invite.maxUses === null || invite.uses < invite.maxUses
    return inTime && usesLeft
}

/**
 * Whether their own link may be handed out again for these settings (D-151):
 * the same lifetime, no limit on uses, and at least half its time left (a
 * link that never expires always is). A link limited in uses is never handed
 * out twice: the one for one friend is not the one for the next.
 */
export function isReusable(invite: InviteRecord, wanted: InviteSettings, now: Date): boolean {
    if (invite.maxUses !== null || wanted.maxUses !== null) return false
    if (invite.maxAgeSeconds !== wanted.maxAgeSeconds || !isLive(invite, now)) return false
    // Never expires only when given no lifetime (the table holds the two together).
    if (invite.maxAgeSeconds === null || invite.expiresAt === null)
        return invite.maxAgeSeconds === null && invite.expiresAt === null
    const leftMs = invite.expiresAt.getTime() - now.getTime()
    return leftMs * 2 >= invite.maxAgeSeconds * 1000
}

/** What joining by an invite comes to, from the rows read under the locks. */
export interface JoinFacts {
    /** Null: no such code, or its server is deleted. */
    invite: Pick<InviteRecord, 'uses' | 'maxUses' | 'expiresAt'> | null
    isMember: boolean
    isBanned: boolean
    /** Live servers they are in now. */
    serverCount: number
}

export type JoinDecision = 'join' | 'already_member'

/**
 * Joining by an invite (REQ-SRV-03, SRV-04), checked in this order:
 * 1. a link that no longer opens is refused, member or not (it shows as
 *    invalid to everyone, so it must not open for some);
 * 2. a member opens the server without using up a use;
 * 3. a banned person is refused, whatever the link;
 * 4. someone already in 100 servers is refused (REQ-SRV-01).
 */
export function decideJoin(facts: JoinFacts, now: Date): JoinDecision {
    if (!facts.invite || !isLive(facts.invite, now)) throw new InviteInvalidError()
    if (facts.isMember) return 'already_member'
    if (facts.isBanned) throw new BannedFromServerError()
    if (facts.serverCount >= MAX_SERVERS_PER_USER) throw new MaxServersReachedError()
    return 'join'
}

/** A channel named in `?channel=`, as the server has it. */
export interface InviteChannelRow extends AccessChannel {
    name: string
    isStudyRoom: boolean
}

/** The target an invite page shows (S-SRV-03 › InviteCard). */
export interface InviteTarget {
    id: string
    name: string
    type: 'text' | 'voice'
    isStudyRoom: boolean
}

/** Someone who has just joined: @everyone and nothing else. */
const NEWCOMER: AccessMember = { userId: '', roleIds: [], timeoutUntil: null }

/**
 * The `?channel=` of a link as the invite page may show it (D-150): only a
 * channel of this server that someone joining sees, worked out by the same
 * rules as for a member holding just @everyone. Private, deleted or another
 * server's: none, and joining opens the first text channel (REQ-SRV-03).
 */
export function inviteTarget(
    server: { ownerId: string; roles: AccessRole[] },
    channel: InviteChannelRow | null,
    now: Date
): InviteTarget | null {
    if (!channel) return null
    const access = { ownerId: server.ownerId, roles: server.roles, channels: [channel] }
    if ((channelPermissions(access, NEWCOMER, channel, now) & Permission.VIEW_CHANNEL) === 0n) return null
    return { id: channel.id, name: channel.name, type: channel.type, isStudyRoom: channel.isStudyRoom }
}
