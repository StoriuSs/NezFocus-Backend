import { AccessMember, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { ServerSnapshot } from './member-view'
import {
    MembershipState,
    planDeleteServer,
    planForgetDeletedMember,
    planLeave,
    planTransferOwnership,
    typedNameMatches
} from './membership'
import { MemberNotFoundError, MembershipRuleError, NotOwnerError, OwnerCannotLeaveError } from './errors'

const NOW = new Date('2026-11-11T09:00:00Z')
const LATER = new Date(NOW.getTime() + 60_000)

/** ÔT (04 world A): An owns it; Tuấn holds ADMINISTRATOR; Bình holds no role. */
const server: ServerSnapshot = {
    id: 'ot',
    name: 'Ôn thi Giải tích 2',
    iconKey: null,
    ownerId: 'an',
    welcomeChannelId: null,
    categories: [],
    channels: [],
    roles: [
        { id: 'everyone', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'admin', name: 'Quản trị', permissions: Permission.ADMINISTRATOR, position: 1, isEveryone: false }
    ]
}

const member = (userId: string, roleIds: string[] = [], timeoutUntil: Date | null = null): AccessMember => ({
    userId,
    roleIds,
    timeoutUntil
})

const state = (
    acting: AccessMember,
    { otherMembers = 2, target = null }: Partial<Pick<MembershipState, 'otherMembers' | 'target'>> = {}
): MembershipState => ({ server, member: acting, otherMembers, target })

const an = member('an')
const tuan = member('tuan', ['admin'])
const binh = member('binh')
const recipient = (who: AccessMember, pendingDeletion = false) => ({ ...who, pendingDeletion })

describe('membership (REQ-SRV-05)', () => {
    describe('planLeave', () => {
        it('takes a member out of the server', () => {
            expect(planLeave(state(binh))).toEqual([{ kind: 'leave', userId: 'binh' }])
        })

        it('takes out one holding ADMINISTRATOR too', () => {
            expect(planLeave(state(tuan))).toEqual([{ kind: 'leave', userId: 'tuan' }])
        })

        it('refuses the owner: they hand it over first', () => {
            expect(() => planLeave(state(an))).toThrow(OwnerCannotLeaveError)
        })

        it('refuses the owner even when no one else is left', () => {
            expect(() => planLeave(state(an, { otherMembers: 0 }))).toThrow(OwnerCannotLeaveError)
        })
    })

    describe('typedNameMatches', () => {
        it.each([
            ['the name as it is', 'Ôn thi Giải tích 2'],
            ['another case', 'ÔN THI GIẢI TÍCH 2'],
            ['no accents', 'on thi giai tich 2'],
            ['spaces around it', '  Ôn thi Giải tích 2 '],
            ['decomposed accents', 'Ôn thi Giải tích 2'.normalize('NFD')]
        ])('accepts %s', (_, typed) => {
            expect(typedNameMatches(typed, 'Ôn thi Giải tích 2')).toBe(true)
        })

        it('reads đ as d', () => {
            expect(typedNameMatches('nhom do an', 'Nhóm đồ án')).toBe(true)
        })

        it.each([
            ['another name', 'Ôn thi Giải tích 1'],
            ['part of it', 'Ôn thi'],
            ['nothing', '']
        ])('refuses %s', (_, typed) => {
            expect(typedNameMatches(typed, 'Ôn thi Giải tích 2')).toBe(false)
        })
    })

    describe('planDeleteServer', () => {
        it('deletes the server when its owner types its name', () => {
            expect(planDeleteServer(state(an), 'on thi giai tich 2')).toEqual([{ kind: 'deleteServer' }])
        })

        it('refuses a name that does not match', () => {
            expect(() => planDeleteServer(state(an), 'Ôn thi')).toThrow(
                expect.objectContaining({ details: { rule: 'name_mismatch' } })
            )
            expect(() => planDeleteServer(state(an), 'Ôn thi')).toThrow(MembershipRuleError)
        })

        it('refuses anyone but the owner, ADMINISTRATOR included', () => {
            expect(() => planDeleteServer(state(tuan), 'Ôn thi Giải tích 2')).toThrow(NotOwnerError)
            expect(() => planDeleteServer(state(binh), 'Ôn thi Giải tích 2')).toThrow(NotOwnerError)
        })
    })

    describe('planTransferOwnership', () => {
        it('hands the server to a member', () => {
            expect(planTransferOwnership(state(an, { target: recipient(binh) }), 'binh', NOW)).toEqual([
                { kind: 'transferOwnership', toUserId: 'binh' }
            ])
        })

        it('hands it to one whose timeout has run out', () => {
            const done = recipient(member('binh', [], NOW))
            expect(planTransferOwnership(state(an, { target: done }), 'binh', NOW)).toEqual([
                { kind: 'transferOwnership', toUserId: 'binh' }
            ])
        })

        it('refuses anyone but the owner, ADMINISTRATOR included', () => {
            expect(() => planTransferOwnership(state(tuan, { target: recipient(binh) }), 'binh', NOW)).toThrow(
                NotOwnerError
            )
        })

        it('refuses the owner naming themselves', () => {
            expect(() => planTransferOwnership(state(an, { target: recipient(an) }), 'an', NOW)).toThrow(
                expect.objectContaining({ details: { rule: 'recipient_self' } })
            )
        })

        it('refuses someone not in the server', () => {
            expect(() => planTransferOwnership(state(an), 'stranger', NOW)).toThrow(MemberNotFoundError)
        })

        it('refuses an account waiting to be deleted', () => {
            expect(() => planTransferOwnership(state(an, { target: recipient(binh, true) }), 'binh', NOW)).toThrow(
                expect.objectContaining({ details: { rule: 'recipient_pending_deletion' } })
            )
        })

        it('refuses a member timed out until later (D-91)', () => {
            const timedOut = recipient(member('binh', [], LATER))
            expect(() => planTransferOwnership(state(an, { target: timedOut }), 'binh', NOW)).toThrow(
                expect.objectContaining({ details: { rule: 'recipient_timed_out' } })
            )
        })
    })

    describe('planForgetDeletedMember (D-76)', () => {
        it('takes a member whose account is deleted out of the server', () => {
            expect(planForgetDeletedMember(state(binh))).toEqual([{ kind: 'leave', userId: 'binh' }])
        })

        it('deletes a server its deleted owner was alone in', () => {
            expect(planForgetDeletedMember(state(an, { otherMembers: 0 }))).toEqual([{ kind: 'deleteServer' }])
        })

        it('leaves a server whose deleted owner still has others in it as it is', () => {
            expect(planForgetDeletedMember(state(an, { otherMembers: 1 }))).toEqual([])
        })
    })
})
