import { AccessRole, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import {
    decideJoin,
    expiresAtFor,
    INVITE_CODE_PATTERN,
    InviteChannelRow,
    InviteRecord,
    inviteTarget,
    isLive,
    isReusable,
    JoinFacts,
    newInviteCode
} from './invites'
import { BannedFromServerError, InviteInvalidError, MaxServersReachedError } from './errors'

const NOW = new Date('2026-11-09T21:47:00Z')
const HOUR = 60 * 60
const DAY = 24 * HOUR
const at = (secondsFromNow: number) => new Date(NOW.getTime() + secondsFromNow * 1000)

/** An's ÔT link k7Qm2xPa, made just now with the default settings (7 days, no limit). */
const invite = (extra: Partial<InviteRecord> = {}): InviteRecord => ({
    code: 'k7Qm2xPa',
    serverId: 'ot',
    creatorId: 'an',
    maxAgeSeconds: 7 * DAY,
    maxUses: null,
    uses: 0,
    expiresAt: at(7 * DAY),
    createdAt: NOW,
    ...extra
})

describe('newInviteCode', () => {
    it('makes 8 letters and digits the API takes back, without characters read alike', () => {
        let n = 0
        const code = newInviteCode((below) => n++ % below)
        expect(code).toMatch(INVITE_CODE_PATTERN)
        expect(code).toHaveLength(8)
        expect(code).not.toMatch(/[0O1lIo]/)
    })

    it('can reach the last character of the alphabet', () => {
        expect(newInviteCode((below) => below - 1)).toBe('99999999')
    })
})

describe('isLive', () => {
    it('opens within its time and its uses', () => {
        expect(isLive(invite(), NOW)).toBe(true)
        expect(isLive(invite({ maxUses: 10, uses: 9 }), NOW)).toBe(true)
        expect(isLive(invite({ expiresAt: null }), NOW)).toBe(true)
    })

    it('no longer opens at the instant it expires, or once its uses are used up', () => {
        expect(isLive(invite({ expiresAt: NOW }), NOW)).toBe(false)
        expect(isLive(invite({ maxUses: 10, uses: 10 }), NOW)).toBe(false)
    })
})

describe('expiresAtFor', () => {
    it('counts the lifetime from now; none for a link that never expires', () => {
        expect(expiresAtFor(30 * 60, NOW)).toEqual(at(30 * 60))
        expect(expiresAtFor(null, NOW)).toBeNull()
    })
})

describe('isReusable (D-151)', () => {
    const unlimited7Days = { maxAgeSeconds: 7 * DAY, maxUses: null }

    it('hands out again their link with the same lifetime and no limit, while half its time is left', () => {
        expect(isReusable(invite(), unlimited7Days, NOW)).toBe(true)
        expect(isReusable(invite({ expiresAt: at(3.5 * DAY) }), unlimited7Days, NOW)).toBe(true)
    })

    it('makes a new one once less than half its time is left', () => {
        expect(isReusable(invite({ expiresAt: at(3.5 * DAY - 1) }), unlimited7Days, NOW)).toBe(false)
    })

    it('always hands out again a link that never expires', () => {
        const never = { maxAgeSeconds: null, maxUses: null }
        expect(isReusable(invite({ maxAgeSeconds: null, expiresAt: null }), never, NOW)).toBe(true)
    })

    it('never hands out a link limited in uses twice, even with the same settings', () => {
        const oneUse = { maxAgeSeconds: 7 * DAY, maxUses: 1 }
        expect(isReusable(invite({ maxUses: 1 }), oneUse, NOW)).toBe(false)
        expect(isReusable(invite({ maxUses: 1 }), unlimited7Days, NOW)).toBe(false)
        expect(isReusable(invite(), oneUse, NOW)).toBe(false)
    })

    it('does not hand out a link with another lifetime', () => {
        expect(isReusable(invite(), { maxAgeSeconds: DAY, maxUses: null }, NOW)).toBe(false)
        expect(isReusable(invite(), { maxAgeSeconds: null, maxUses: null }, NOW)).toBe(false)
    })
})

describe('decideJoin', () => {
    const facts = (extra: Partial<JoinFacts> = {}): JoinFacts => ({
        invite: invite(),
        isMember: false,
        isBanned: false,
        serverCount: 3,
        ...extra
    })

    it('joins with a live link', () => {
        expect(decideJoin(facts(), NOW)).toBe('join')
        expect(decideJoin(facts({ serverCount: 99 }), NOW)).toBe('join')
    })

    it('refuses a missing, used up or expired link, even to a member', () => {
        expect(() => decideJoin(facts({ invite: null }), NOW)).toThrow(InviteInvalidError)
        expect(() => decideJoin(facts({ invite: invite({ maxUses: 5, uses: 5 }) }), NOW)).toThrow(InviteInvalidError)
        expect(() => decideJoin(facts({ invite: invite({ expiresAt: NOW }), isMember: true }), NOW)).toThrow(
            InviteInvalidError
        )
    })

    it('lets a member through without joining again', () => {
        expect(decideJoin(facts({ isMember: true, serverCount: 100 }), NOW)).toBe('already_member')
    })

    it('refuses someone banned, before counting their servers', () => {
        expect(() => decideJoin(facts({ isBanned: true, serverCount: 100 }), NOW)).toThrow(BannedFromServerError)
    })

    it('refuses someone already in 100 servers', () => {
        expect(() => decideJoin(facts({ serverCount: 100 }), NOW)).toThrow(MaxServersReachedError)
    })
})

describe('inviteTarget (D-150)', () => {
    const everyone = (permissions = EVERYONE_DEFAULT_PERMISSIONS): AccessRole => ({
        id: 'everyone',
        permissions,
        position: 0,
        isEveryone: true
    })
    const server = { ownerId: 'an', roles: [everyone()] }
    const room: InviteChannelRow = {
        id: 'phong-thao-luan',
        type: 'voice',
        isPrivate: false,
        viewRoleIds: [],
        sendMode: 'everyone',
        name: 'Phòng thảo luận nhóm',
        isStudyRoom: true
    }

    it('shows a channel someone joining sees', () => {
        expect(inviteTarget(server, room, NOW)).toEqual({
            id: 'phong-thao-luan',
            name: 'Phòng thảo luận nhóm',
            type: 'voice',
            isStudyRoom: true
        })
    })

    it('hides a private channel, even one a role sees', () => {
        expect(inviteTarget(server, { ...room, isPrivate: true, viewRoleIds: ['truong-nhom'] }, NOW)).toBeNull()
    })

    it('hides every channel when @everyone may not view channels', () => {
        const closed = { ...server, roles: [everyone(EVERYONE_DEFAULT_PERMISSIONS & ~Permission.VIEW_CHANNEL)] }
        expect(inviteTarget(closed, room, NOW)).toBeNull()
    })

    it('shows none when there is no such channel in the server', () => {
        expect(inviteTarget(server, null, NOW)).toBeNull()
    })
})
