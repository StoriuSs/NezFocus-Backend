import { AccessMember } from '@/modules/permissions'
import { ServerSnapshot } from './member-view'
import { MemberNotFoundError, MembershipRuleError, NotOwnerError, OwnerCannotLeaveError } from './errors'

/*
 * Leaving a server, deleting it and handing it over (REQ-SRV-05, D-76, D-91).
 * Each is decided here by a pure function, from the server and the people
 * concerned as read inside the write's transaction with the server row
 * locked, like the roles and the moderation.
 */

/** How long a deleted server's row is kept before it goes for good (REQ-SRV-05). */
export const DELETED_SERVER_KEPT_DAYS = 30

/** Servers deleted before this are deleted for good. */
export function purgeDeletedBefore(now: Date): Date {
    return new Date(now.getTime() - DELETED_SERVER_KEPT_DAYS * 24 * 60 * 60 * 1000)
}

export interface MembershipState {
    server: ServerSnapshot
    /** The person acting. */
    member: AccessMember
    /** How many others are in the server, not counting deleted accounts. */
    otherMembers: number
    /** The one named (a handover), when they are in the server. */
    target: (AccessMember & { pendingDeletion: boolean }) | null
}

export type MembershipWrite =
    | { kind: 'leave'; userId: string }
    | { kind: 'transferOwnership'; toUserId: string }
    | { kind: 'deleteServer' }

const isOwner = ({ server, member }: MembershipState) => server.ownerId === member.userId

function requireOwner(state: MembershipState): void {
    if (!isOwner(state)) throw new NotOwnerError()
}

/** Out of the server, roles and all; back in with a new invite. Not the owner. */
export function planLeave(state: MembershipState): MembershipWrite[] {
    if (isOwner(state)) throw new OwnerCannotLeaveError()
    return [{ kind: 'leave', userId: state.member.userId }]
}

/** Without accents (đ as d), case or the spaces around it, as the client compares it (`sameTyped`). */
const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().trim()

/** The name typed to confirm a deletion is the server's, ignoring case and accents (REQ-SRV-05). */
export function typedNameMatches(typed: string, name: string): boolean {
    return folded(typed) === folded(name)
}

/**
 * Gone for every member at once (S-SET-07 `delete-type-name`): the owner
 * types its name to confirm. The row is kept for 30 days, then deleted for
 * good with everything in it.
 */
export function planDeleteServer(state: MembershipState, typedName: string): MembershipWrite[] {
    requireOwner(state)
    if (!typedNameMatches(typedName, state.server.name)) throw new MembershipRuleError('name_mismatch')
    return [{ kind: 'deleteServer' }]
}

/**
 * Hand the server to another member (S-SET-07 `transfer-password`; the
 * password is checked before this). Not to an account waiting to be deleted,
 * nor to someone timed out: ending the timeout is a step of its own (D-91).
 * The old owner keeps every role they hold.
 */
export function planTransferOwnership(state: MembershipState, toUserId: string, now: Date): MembershipWrite[] {
    requireOwner(state)
    if (toUserId === state.member.userId) throw new MembershipRuleError('recipient_self')
    const { target } = state
    if (!target) throw new MemberNotFoundError(toUserId)
    if (target.pendingDeletion) throw new MembershipRuleError('recipient_pending_deletion')
    if (target.timeoutUntil !== null && target.timeoutUntil.getTime() > now.getTime()) {
        throw new MembershipRuleError('recipient_timed_out')
    }
    return [{ kind: 'transferOwnership', toUserId }]
}

/**
 * What a deleted account leaves behind in one server (D-76): they go, and a
 * server they owned alone goes with them. One they owned with others in it
 * stays as it is, and the caller reports it rather than guessing an owner.
 * Asking to delete was refused while there were others, checked again once
 * the request was saved, and the invites of the servers they owned alone
 * were revoked twice (D-121, L9 review): only a join through an invite made
 * in the moment before the second revoke could leave one.
 */
export function planForgetDeletedMember(state: MembershipState): MembershipWrite[] {
    if (!isOwner(state)) return [{ kind: 'leave', userId: state.member.userId }]
    return state.otherMembers === 0 ? [{ kind: 'deleteServer' }] : []
}
