import { AccessMember, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { RoleSnapshot, ServerSnapshot } from './member-view'
import {
    ModerationState,
    moderationReason,
    planBan,
    planKick,
    planTimeout,
    planUnban,
    REASON_MAX_LENGTH,
    timeoutForViewer
} from './moderation'
import {
    BanNotFoundError,
    MemberNotFoundError,
    MissingPermissionError,
    ModerationRuleError,
    RoleHierarchyError
} from './errors'

const NOW = new Date('2026-11-10T09:00:00Z')
const LATER = (seconds: number) => new Date(NOW.getTime() + seconds * 1000)

const role = (id: string, position: number, permissions: bigint): RoleSnapshot => ({
    id,
    name: id,
    position,
    permissions,
    isEveryone: false
})

/**
 * ÔT (04 world A): An owns it; Tuấn is Quản trị (ADMINISTRATOR); Bình is
 * Trưởng nhóm (kicks and times out, does not ban); Chi coordinates rooms;
 * Dũng holds no role.
 */
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
        role('mod', 1, Permission.MANAGE_STUDY_ROOMS),
        role('lead', 2, Permission.KICK_MEMBERS | Permission.MODERATE_MEMBERS),
        role('admin', 3, Permission.ADMINISTRATOR)
    ]
}

const member = (userId: string, roleIds: string[] = [], timeoutUntil: Date | null = null): AccessMember => ({
    userId,
    roleIds,
    timeoutUntil
})

const an = member('an')
const tuan = member('tuan', ['admin'])
const binh = member('binh', ['lead'])
const chi = member('chi', ['mod'])
const dung = member('dung')

const as = (who: AccessMember, target: AccessMember | null, banned = false): ModerationState => ({
    server,
    member: who,
    target,
    banned
})

describe('moderationReason', () => {
    it('trims, and takes an empty one for none', () => {
        expect(moderationReason('  Gửi tin liên tục  ')).toBe('Gửi tin liên tục')
        expect(moderationReason('   ')).toBeNull()
        expect(moderationReason(null)).toBeNull()
    })

    it('takes 512 characters and refuses 513 (REQ-ROLE-04)', () => {
        expect(moderationReason('a'.repeat(REASON_MAX_LENGTH))).toHaveLength(512)
        expect(() => moderationReason('a'.repeat(REASON_MAX_LENGTH + 1))).toThrow(
            new ModerationRuleError('reason_too_long')
        )
    })
})

describe('planKick', () => {
    it('puts out someone ranked below', () => {
        expect(planKick(as(binh, dung), 'dung', null, NOW)).toEqual([{ kind: 'kick', userId: 'dung' }])
        expect(planKick(as(binh, chi), 'chi', 'Spam', NOW)).toEqual([{ kind: 'kick', userId: 'chi' }])
    })

    it('needs KICK_MEMBERS', () => {
        expect(() => planKick(as(chi, dung), 'dung', null, NOW)).toThrow(MissingPermissionError)
    })

    it('needs it now: someone timed out only views', () => {
        const timedOut = member('binh', ['lead'], LATER(60))
        expect(() => planKick(as(timedOut, dung), 'dung', null, NOW)).toThrow(MissingPermissionError)
    })

    it('never reaches the owner, an equal or higher, or themselves', () => {
        expect(() => planKick(as(binh, an), 'an', null, NOW)).toThrow(RoleHierarchyError)
        expect(() => planKick(as(binh, tuan), 'tuan', null, NOW)).toThrow(RoleHierarchyError)
        expect(() => planKick(as(binh, member('binh2', ['lead'])), 'binh2', null, NOW)).toThrow(RoleHierarchyError)
        expect(() => planKick(as(binh, binh), 'binh', null, NOW)).toThrow(RoleHierarchyError)
        expect(() => planKick(as(an, an), 'an', null, NOW)).toThrow(RoleHierarchyError)
    })

    it('lets the owner put out anyone else, an administrator included', () => {
        expect(planKick(as(an, tuan), 'tuan', null, NOW)).toEqual([{ kind: 'kick', userId: 'tuan' }])
    })

    it('answers not found for someone not in the server', () => {
        expect(() => planKick(as(binh, null), 'khanh', null, NOW)).toThrow(MemberNotFoundError)
    })

    it('refuses a reason past 512 characters, though nothing keeps it yet (D-156)', () => {
        expect(() => planKick(as(binh, dung), 'dung', 'a'.repeat(513), NOW)).toThrow(ModerationRuleError)
    })
})

describe('planBan', () => {
    it('bans with the reason trimmed and who banned', () => {
        expect(planBan(as(an, dung), 'dung', '  Bán đề thi có đáp án ', NOW)).toEqual([
            { kind: 'ban', userId: 'dung', reason: 'Bán đề thi có đáp án', bannedById: 'an' }
        ])
        expect(planBan(as(tuan, binh), 'binh', '', NOW)).toEqual([
            { kind: 'ban', userId: 'binh', reason: null, bannedById: 'tuan' }
        ])
    })

    it('needs BAN_MEMBERS: kicking is not enough', () => {
        expect(() => planBan(as(binh, dung), 'dung', null, NOW)).toThrow(MissingPermissionError)
    })

    it('never reaches the owner or someone level with them', () => {
        expect(() => planBan(as(tuan, an), 'an', null, NOW)).toThrow(RoleHierarchyError)
        expect(() => planBan(as(tuan, member('tuan2', ['admin'])), 'tuan2', null, NOW)).toThrow(RoleHierarchyError)
    })

    it('only someone in the server (D-155)', () => {
        expect(() => planBan(as(an, null), 'khanh', null, NOW)).toThrow(MemberNotFoundError)
    })
})

describe('planUnban', () => {
    it('lifts a ban with BAN_MEMBERS, whatever the rank', () => {
        expect(planUnban(as(tuan, null, true), 'khanh', NOW)).toEqual([{ kind: 'unban', userId: 'khanh' }])
    })

    it('answers not found when they are not banned', () => {
        expect(() => planUnban(as(an, null, false), 'khanh', NOW)).toThrow(BanNotFoundError)
    })

    it('needs BAN_MEMBERS', () => {
        expect(() => planUnban(as(binh, null, true), 'khanh', NOW)).toThrow(MissingPermissionError)
    })
})

describe('planTimeout', () => {
    it('times out for one of the six lengths, from now, with the reason', () => {
        expect(planTimeout(as(binh, dung), 'dung', 3600, ' Gửi tin liên tục ', NOW)).toEqual([
            { kind: 'timeOut', userId: 'dung', until: LATER(3600), reason: 'Gửi tin liên tục' }
        ])
    })

    it('counts a new length again from now, not from the current end (no gap)', () => {
        const timedOut = member('dung', [], LATER(30))
        expect(planTimeout(as(binh, timedOut), 'dung', 60, null, NOW)).toEqual([
            { kind: 'timeOut', userId: 'dung', until: LATER(60), reason: null }
        ])
    })

    it('refuses any other length', () => {
        expect(() => planTimeout(as(binh, dung), 'dung', 120, null, NOW)).toThrow(
            new ModerationRuleError('timeout_invalid')
        )
        expect(() => planTimeout(as(binh, dung), 'dung', 0, null, NOW)).toThrow(ModerationRuleError)
    })

    it('refuses someone holding ADMINISTRATOR, even while timed out (D-147)', () => {
        expect(() => planTimeout(as(an, tuan), 'tuan', 60, null, NOW)).toThrow(new ModerationRuleError('target_admin'))
        const adminTimedOut = member('tuan', ['admin'], LATER(600))
        expect(() => planTimeout(as(an, adminTimedOut), 'tuan', 60, null, NOW)).toThrow(ModerationRuleError)
    })

    it('ends a running timeout early with null, and does nothing when none runs', () => {
        expect(planTimeout(as(binh, member('dung', [], LATER(60))), 'dung', null, null, NOW)).toEqual([
            { kind: 'endTimeout', userId: 'dung' }
        ])
        expect(planTimeout(as(binh, dung), 'dung', null, null, NOW)).toEqual([])
        expect(planTimeout(as(binh, member('dung', [], NOW)), 'dung', null, null, NOW)).toEqual([])
    })

    it('needs MODERATE_MEMBERS, and the rank, to end one too', () => {
        expect(() => planTimeout(as(chi, dung), 'dung', null, null, NOW)).toThrow(MissingPermissionError)
        expect(() => planTimeout(as(binh, an), 'an', null, null, NOW)).toThrow(RoleHierarchyError)
    })
})

describe('timeoutForViewer (D-154)', () => {
    const item = { userId: 'dung', timeoutUntil: LATER(60), timeoutReason: 'Gửi tin liên tục' }

    it('shows a running timeout to everyone, its reason only to moderators', () => {
        expect(timeoutForViewer(item, { userId: 'chi', mayModerate: false }, NOW)).toEqual({
            ...item,
            timeoutReason: null
        })
        expect(timeoutForViewer(item, { userId: 'binh', mayModerate: true }, NOW)).toEqual(item)
    })

    it('shows the reason to the one timed out', () => {
        expect(timeoutForViewer(item, { userId: 'dung', mayModerate: false }, NOW)).toEqual(item)
    })

    it('shows nothing of a timeout that has run out', () => {
        expect(timeoutForViewer({ ...item, timeoutUntil: NOW }, { userId: 'binh', mayModerate: true }, NOW)).toEqual({
            ...item,
            timeoutUntil: null,
            timeoutReason: null
        })
    })
})
