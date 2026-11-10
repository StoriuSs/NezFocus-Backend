import { AccessMember, outranksMember, Permission, PermissionName, serverPermissions } from '@/modules/permissions'
import { ServerSnapshot } from './member-view'
import {
    BanNotFoundError,
    MemberNotFoundError,
    MissingPermissionError,
    ModerationRuleError,
    RoleHierarchyError
} from './server.errors'

/*
 * Kick, ban and time out (REQ-ROLE-04, D-147, D-154 → D-156). As with the
 * roles, each is decided here by a pure function, from the server, the person
 * acting and the one acted on as read inside the write's transaction with the
 * server row locked, so a role handed out a moment earlier is seen.
 */

/** The six lengths of a timeout (REQ-ROLE-04, 04 Q8): 60 s, 5 min, 10 min, 1 h, 1 day, 1 week. */
export const TIMEOUT_SECONDS = [60, 300, 600, 3600, 86_400, 604_800] as const
/** The longest reason for a kick, ban or timeout. */
export const REASON_MAX_LENGTH = 512

export interface ModerationState {
    server: ServerSnapshot
    member: AccessMember
    /** The one acted on, when they are in the server. */
    target: AccessMember | null
    /** Whether the one acted on is banned from it. */
    banned: boolean
}

export type ModerationWrite =
    | { kind: 'kick'; userId: string }
    | { kind: 'ban'; userId: string; reason: string | null; bannedById: string }
    | { kind: 'timeOut'; userId: string; until: Date; reason: string | null }
    | { kind: 'endTimeout'; userId: string }
    | { kind: 'unban'; userId: string }

const accessOf = (server: ServerSnapshot) => ({
    ownerId: server.ownerId,
    roles: server.roles,
    channels: server.channels
})

function requirePermission({ server, member }: ModerationState, permission: PermissionName, now: Date): void {
    if ((serverPermissions(accessOf(server), member, now) & Permission[permission]) === 0n) {
        throw new MissingPermissionError(permission)
    }
}

/**
 * Someone in the server ranked strictly below them: never the owner, never
 * themselves, never an equal (REQ-ROLE-04, ROLE-02).
 */
function requireTarget(state: ModerationState, userId: string): AccessMember {
    const { target } = state
    if (!target) throw new MemberNotFoundError(userId)
    if (!outranksMember(accessOf(state.server), state.member, target)) throw new RoleHierarchyError()
    return target
}

/** Trimmed; empty is none. Longer than 512 is refused. */
export function moderationReason(typed: string | null | undefined): string | null {
    const reason = typed?.trim() ?? ''
    if (reason.length > REASON_MAX_LENGTH) throw new ModerationRuleError('reason_too_long')
    return reason === '' ? null : reason
}

/**
 * Out of the server; back in with a new invite. The reason reaches them with
 * the realtime dialog (M2) and the inbox (M3); nothing keeps it before (D-156).
 */
export function planKick(state: ModerationState, userId: string, reason: string | null, now: Date): ModerationWrite[] {
    requirePermission(state, 'KICK_MEMBERS', now)
    moderationReason(reason)
    requireTarget(state, userId)
    return [{ kind: 'kick', userId }]
}

/**
 * Out of the server and kept out until unbanned, with the reason, the day and
 * who banned. Only someone in the server (D-155).
 */
export function planBan(state: ModerationState, userId: string, reason: string | null, now: Date): ModerationWrite[] {
    requirePermission(state, 'BAN_MEMBERS', now)
    const kept = moderationReason(reason)
    requireTarget(state, userId)
    return [{ kind: 'ban', userId, reason: kept, bannedById: state.member.userId }]
}

/** Back in with any valid invite. No rank: the one banned holds no role any more. */
export function planUnban(state: ModerationState, userId: string, now: Date): ModerationWrite[] {
    requirePermission(state, 'BAN_MEMBERS', now)
    if (!state.banned) throw new BanNotFoundError(userId)
    return [{ kind: 'unban', userId }]
}

/**
 * Times them out for one of the six lengths from now, a new timeout or a new
 * length for the current one (counted again from now, no gap), or, with
 * `seconds` null, ends it early (REQ-ROLE-04). Not someone holding
 * ADMINISTRATOR, who would keep every permission anyway (D-147).
 */
export function planTimeout(
    state: ModerationState,
    userId: string,
    seconds: number | null,
    reason: string | null,
    now: Date
): ModerationWrite[] {
    requirePermission(state, 'MODERATE_MEMBERS', now)
    const kept = moderationReason(reason)
    const target = requireTarget(state, userId)

    if (seconds === null) {
        const timedOut = target.timeoutUntil !== null && target.timeoutUntil.getTime() > now.getTime()
        return timedOut ? [{ kind: 'endTimeout', userId }] : []
    }
    if (!(TIMEOUT_SECONDS as readonly number[]).includes(seconds)) throw new ModerationRuleError('timeout_invalid')
    // ADMINISTRATOR counts before any timeout (appendix B step 2), so a running one hides nothing.
    if ((serverPermissions(accessOf(state.server), target, now) & Permission.ADMINISTRATOR) !== 0n) {
        throw new ModerationRuleError('target_admin')
    }
    return [{ kind: 'timeOut', userId, until: new Date(now.getTime() + seconds * 1000), reason: kept }]
}

/** A member as the member list shows them to one viewer (D-154). */
export interface ListedTimeout {
    userId: string
    timeoutUntil: Date | null
    timeoutReason: string | null
}

/**
 * Only a timeout still running is shown, to everyone; its reason only to
 * those who may time people out and to the one timed out (D-154).
 */
export function timeoutForViewer<T extends ListedTimeout>(
    item: T,
    viewer: { userId: string; mayModerate: boolean },
    now: Date
): T {
    const running = item.timeoutUntil !== null && item.timeoutUntil.getTime() > now.getTime()
    if (!running) return { ...item, timeoutUntil: null, timeoutReason: null }
    const seesReason = viewer.mayModerate || viewer.userId === item.userId
    return seesReason ? item : { ...item, timeoutReason: null }
}
