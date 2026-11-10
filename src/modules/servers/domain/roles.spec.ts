import { AccessMember, EVERYONE_DEFAULT_PERMISSIONS, Permission } from '@/modules/permissions'
import { RoleSnapshot, ServerSnapshot } from './member-view'
import {
    MAX_ROLES,
    planCreateRole,
    planDeleteRole,
    planGrantRole,
    planReorderRoles,
    planRevokeRole,
    planUpdateRole,
    rolePositionsValid,
    RoleState,
    RoleWrite
} from './roles'
import {
    MemberNotFoundError,
    MissingPermissionError,
    RoleHierarchyError,
    RoleNotFoundError,
    RoleOrderStaleError,
    RoleRuleError
} from './server.errors'

const NOW = new Date('2026-11-10T09:00:00Z')

const role = (id: string, name: string, position: number, permissions: bigint): RoleSnapshot => ({
    id,
    name,
    position,
    permissions,
    isEveryone: false
})

/**
 * ÔT (04 world A): Quản trị on top, Trưởng nhóm, Điều phối phòng học, Nhóm
 * tài liệu, then @everyone. An owns it; Tuấn is Quản trị; Bình is Trưởng
 * nhóm (manages roles, kicks, times out); Chi coordinates rooms; Dũng holds
 * no role.
 */
const roles: RoleSnapshot[] = [
    { id: 'everyone', name: '@everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
    role('docs', 'Nhóm tài liệu', 1, 0n),
    role('mod', 'Điều phối phòng học', 2, Permission.MANAGE_STUDY_ROOMS),
    role('lead', 'Trưởng nhóm', 3, Permission.MANAGE_ROLES | Permission.KICK_MEMBERS | Permission.MODERATE_MEMBERS),
    role('admin', 'Quản trị', 4, Permission.ADMINISTRATOR)
]

const server: ServerSnapshot = {
    id: 'ot',
    name: 'Ôn thi Giải tích 2',
    iconKey: null,
    ownerId: 'an',
    welcomeChannelId: null,
    categories: [],
    channels: [],
    roles
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
const everybody = [an, tuan, binh, chi, dung]

const as = (who: AccessMember, changed: Partial<ServerSnapshot> = {}): RoleState => ({
    server: { ...server, ...changed },
    member: who,
    targets: everybody
})

const withEveryone = (bits: bigint) =>
    roles.map((r) => (r.isEveryone ? { ...r, permissions: r.permissions | bits } : r))

/** The roles after the writes, as the repository would leave them. */
function applied(before: RoleSnapshot[], writes: RoleWrite[]): RoleSnapshot[] {
    let after = before.map((r) => ({ ...r }))
    for (const write of writes) {
        if (write.kind === 'createRole') after.push(role('new', write.name, write.position, 0n))
        if (write.kind === 'deleteRole') after = after.filter((r) => r.id !== write.id)
        if (write.kind === 'placeRoles') {
            for (const place of write.places) after.find((r) => r.id === place.id)!.position = place.position
        }
    }
    return after
}

const order = (list: RoleSnapshot[]) =>
    list
        .filter((r) => !r.isEveryone)
        .sort((a, b) => b.position - a.position)
        .map((r) => r.id)

describe('role positions', () => {
    it('hold @everyone at 0 and the others at 1…n, no gap, no repeat', () => {
        expect(rolePositionsValid(roles)).toBe(true)
        expect(rolePositionsValid(roles.map((r) => (r.id === 'docs' ? { ...r, position: 2 } : r)))).toBe(false)
        expect(rolePositionsValid(roles.filter((r) => r.id !== 'docs'))).toBe(false)
        expect(rolePositionsValid(roles.map((r) => (r.isEveryone ? { ...r, position: 1 } : r)))).toBe(false)
        expect(rolePositionsValid(roles.filter((r) => !r.isEveryone))).toBe(false)
    })
})

describe('planCreateRole (REQ-ROLE-01, D-87)', () => {
    it('puts the owner’s new role on top, with no permissions', () => {
        const writes = planCreateRole(as(an), 'Nhóm đề', NOW)
        expect(writes).toEqual([{ kind: 'createRole', name: 'Nhóm đề', nameKey: 'nhóm đề', position: 5 }])
        expect(rolePositionsValid(applied(roles, writes))).toBe(true)
    })

    it('puts it right below the creator’s highest role, moving that and those above up one', () => {
        const writes = planCreateRole(as(binh), 'Nhóm đề', NOW)
        const after = applied(roles, writes)
        expect(order(after)).toEqual(['admin', 'lead', 'new', 'mod', 'docs'])
        expect(rolePositionsValid(after)).toBe(true)
    })

    it('puts the role of someone holding no role on top', () => {
        const state = as(dung, { roles: withEveryone(Permission.MANAGE_ROLES) })
        expect(order(applied(roles, planCreateRole(state, 'Nhóm đề', NOW)))[0]).toBe('new')
    })

    it('needs MANAGE_ROLES, which a timeout takes away', () => {
        expect(() => planCreateRole(as(dung), 'Nhóm đề', NOW)).toThrow(MissingPermissionError)
        const timedOut = member('binh', ['lead'], new Date(NOW.getTime() + 60_000))
        expect(() => planCreateRole(as(timedOut), 'Nhóm đề', NOW)).toThrow(MissingPermissionError)
    })

    it.each([
        ['trưởng nhóm', 'name_taken'],
        ['  Quản trị ', 'name_taken'],
        ['everyone', 'name_reserved'],
        ['@Everyone', 'name_reserved'],
        ['@here', 'name_reserved'],
        ['HERE', 'name_reserved'],
        ['@@Every one', 'name_reserved'],
        ['＠here', 'name_reserved'],
        ['every​one', 'name_reserved'],
        ['   ', 'name_invalid'],
        ['x'.repeat(101), 'name_invalid']
    ])('refuses “%s” (%s)', (name, rule) => {
        expect(() => planCreateRole(as(an), name, NOW)).toThrow(expect.objectContaining({ details: { rule } }))
    })

    it('takes a name differing from another only by accents', () => {
        expect(planCreateRole(as(an), 'Truong nhom', NOW)).toHaveLength(1)
    })

    it('stops at 50 roles, @everyone not counted', () => {
        const many = [
            roles[0]!,
            ...Array.from({ length: MAX_ROLES - 1 }, (_, i) => role(`r${i}`, `Nhóm ${i}`, i + 1, 0n))
        ]
        expect(planCreateRole(as(an, { roles: many }), 'Nhóm cuối', NOW)).toHaveLength(1)
        const full = [...many, role('last', 'Nhóm 50', MAX_ROLES, 0n)]
        expect(() => planCreateRole(as(an, { roles: full }), 'Nhóm mới', NOW)).toThrow(
            expect.objectContaining({ details: { rule: 'limit' } })
        )
    })
})

describe('planUpdateRole (REQ-ROLE-02, D-148)', () => {
    it('lets someone grant a permission they hold to a lower role', () => {
        expect(planUpdateRole(as(binh), 'docs', { permissions: Permission.KICK_MEMBERS }, NOW)).toEqual([
            { kind: 'updateRole', id: 'docs', changes: { permissions: Permission.KICK_MEMBERS } }
        ])
    })

    it('refuses a permission they do not hold, with FORBIDDEN_ERROR', () => {
        expect(() => planUpdateRole(as(binh), 'docs', { permissions: Permission.BAN_MEMBERS }, NOW)).toThrow(
            MissingPermissionError
        )
    })

    it('leaves alone a bit they lack while they change others', () => {
        const after = Permission.MANAGE_STUDY_ROOMS | Permission.KICK_MEMBERS
        expect(planUpdateRole(as(binh), 'mod', { permissions: after }, NOW)).toHaveLength(1)
        expect(() => planUpdateRole(as(binh), 'mod', { permissions: Permission.KICK_MEMBERS }, NOW)).toThrow(
            MissingPermissionError
        )
    })

    it('refuses their own highest role and any above it', () => {
        expect(() => planUpdateRole(as(binh), 'lead', { name: 'Trưởng nhóm K22' }, NOW)).toThrow(RoleHierarchyError)
        expect(() => planUpdateRole(as(binh), 'admin', { mentionable: true }, NOW)).toThrow(RoleHierarchyError)
    })

    it('gives an administrator every permission to hand out, still under the hierarchy', () => {
        expect(planUpdateRole(as(tuan), 'lead', { permissions: Permission.BAN_MEMBERS }, NOW)).toHaveLength(1)
        expect(() => planUpdateRole(as(tuan), 'admin', { name: 'Ban quản trị' }, NOW)).toThrow(RoleHierarchyError)
    })

    it('lets the owner change any role, the top one included', () => {
        expect(planUpdateRole(as(an), 'admin', { name: 'Ban quản trị', mentionable: true }, NOW)).toEqual([
            {
                kind: 'updateRole',
                id: 'admin',
                changes: { name: 'Ban quản trị', nameKey: 'ban quản trị', mentionable: true }
            }
        ])
    })

    it('changes only the permissions of @everyone', () => {
        const fewer = EVERYONE_DEFAULT_PERMISSIONS & ~Permission.CREATE_INVITE
        expect(planUpdateRole(as(binh), 'everyone', { permissions: fewer }, NOW)).toHaveLength(1)
        const more = EVERYONE_DEFAULT_PERMISSIONS | Permission.BAN_MEMBERS
        expect(() => planUpdateRole(as(binh), 'everyone', { permissions: more }, NOW)).toThrow(MissingPermissionError)
        expect(() => planUpdateRole(as(an), 'everyone', { name: 'mọi người' }, NOW)).toThrow(
            expect.objectContaining({ details: { rule: 'everyone_fixed' } })
        )
        expect(() => planUpdateRole(as(an), 'everyone', { mentionable: true }, NOW)).toThrow(RoleRuleError)
    })

    it('refuses a bit that is no permission', () => {
        expect(() => planUpdateRole(as(an), 'docs', { permissions: 1n << 9n }, NOW)).toThrow(
            expect.objectContaining({ details: { rule: 'unknown_bits' } })
        )
    })

    it('renames a role to its own name in other capitals, and writes nothing for nothing', () => {
        expect(planUpdateRole(as(an), 'docs', { name: 'NHÓM TÀI LIỆU' }, NOW)).toHaveLength(1)
        expect(planUpdateRole(as(an), 'docs', {}, NOW)).toEqual([])
    })

    it('answers NOT_FOUND for a role not in the server', () => {
        expect(() => planUpdateRole(as(an), 'elsewhere', { name: 'X' }, NOW)).toThrow(RoleNotFoundError)
    })
})

describe('planDeleteRole', () => {
    it('closes the gap it leaves', () => {
        const writes = planDeleteRole(as(tuan), 'mod', NOW)
        const after = applied(roles, writes)
        expect(order(after)).toEqual(['admin', 'lead', 'docs'])
        expect(rolePositionsValid(after)).toBe(true)
    })

    it('writes no move when the top role goes', () => {
        expect(planDeleteRole(as(an), 'admin', NOW)).toEqual([{ kind: 'deleteRole', id: 'admin' }])
    })

    it('needs every bit of the role, since its members lose them (D-148)', () => {
        expect(() => planDeleteRole(as(binh), 'mod', NOW)).toThrow(MissingPermissionError)
        expect(planDeleteRole(as(binh), 'docs', NOW)).toHaveLength(2)
    })

    it('keeps @everyone and roles at or above their own', () => {
        expect(() => planDeleteRole(as(an), 'everyone', NOW)).toThrow(RoleRuleError)
        expect(() => planDeleteRole(as(binh), 'lead', NOW)).toThrow(RoleHierarchyError)
    })
})

describe('planReorderRoles (REQ-ROLE-02, 04 Edge)', () => {
    const current = ['admin', 'lead', 'mod', 'docs']

    it('lets the owner put any role anywhere, writing only what moved', () => {
        const writes = planReorderRoles(as(an), current, ['lead', 'admin', 'mod', 'docs'], NOW)
        expect(writes).toEqual([
            {
                kind: 'placeRoles',
                places: [
                    { id: 'lead', position: 4 },
                    { id: 'admin', position: 3 }
                ]
            }
        ])
        expect(rolePositionsValid(applied(roles, writes))).toBe(true)
    })

    it('lets someone swap roles below their highest', () => {
        const writes = planReorderRoles(as(binh), current, ['admin', 'lead', 'docs', 'mod'], NOW)
        expect(order(applied(roles, writes))).toEqual(['admin', 'lead', 'docs', 'mod'])
    })

    it('refuses to move a role to or above their highest, or to move theirs', () => {
        expect(() => planReorderRoles(as(binh), current, ['admin', 'mod', 'lead', 'docs'], NOW)).toThrow(
            RoleHierarchyError
        )
        expect(() => planReorderRoles(as(tuan), current, ['lead', 'admin', 'mod', 'docs'], NOW)).toThrow(
            RoleHierarchyError
        )
    })

    it('lets someone holding no role move nothing', () => {
        const state = as(dung, { roles: withEveryone(Permission.MANAGE_ROLES) })
        expect(() => planReorderRoles(state, current, ['admin', 'lead', 'docs', 'mod'], NOW)).toThrow(
            RoleHierarchyError
        )
        expect(planReorderRoles(state, current, current, NOW)).toEqual([])
    })

    it('refuses an order made from a list that has changed since', () => {
        expect(() => planReorderRoles(as(an), ['lead', 'admin', 'mod', 'docs'], current, NOW)).toThrow(
            RoleOrderStaleError
        )
    })

    it('takes a malformed request for one, not for a stale list (no endless reload)', () => {
        expect(() => planReorderRoles(as(an), ['admin', 'lead', 'mod'], current, NOW)).toThrow(RoleRuleError)
        expect(() => planReorderRoles(as(an), ['admin', 'admin', 'mod', 'docs'], current, NOW)).toThrow(
            expect.objectContaining({ details: { rule: 'order_invalid' } })
        )
    })

    it('refuses an order that is not the same roles', () => {
        expect(() => planReorderRoles(as(an), current, ['admin', 'lead', 'mod', 'mod'], NOW)).toThrow(
            expect.objectContaining({ details: { rule: 'order_invalid' } })
        )
        expect(() => planReorderRoles(as(an), current, ['admin', 'lead', 'mod', 'everyone'], NOW)).toThrow(
            RoleRuleError
        )
    })

    it('needs MANAGE_ROLES', () => {
        expect(() => planReorderRoles(as(chi), current, current, NOW)).toThrow(MissingPermissionError)
    })
})

describe('planGrantRole (D-148, D-153)', () => {
    it('adds everyone named who lacks it, in one write', () => {
        expect(planGrantRole(as(binh), 'docs', ['chi', 'dung', 'chi'], NOW)).toEqual([
            { kind: 'grantRole', roleId: 'docs', userIds: ['chi', 'dung'] }
        ])
    })

    it('lets them give a lower role to themselves', () => {
        expect(planGrantRole(as(binh), 'docs', ['binh'], NOW)).toHaveLength(1)
        expect(planGrantRole(as(an), 'lead', ['an'], NOW)).toHaveLength(1)
    })

    it('adds no one when one of them ranks level or above (all or none)', () => {
        expect(() => planGrantRole(as(binh), 'docs', ['dung', 'tuan'], NOW)).toThrow(RoleHierarchyError)
        expect(() => planGrantRole(as(tuan), 'docs', ['an'], NOW)).toThrow(RoleHierarchyError)
        const peer = member('ha', ['lead'])
        const state = { ...as(binh), targets: [...everybody, peer] }
        expect(() => planGrantRole(state, 'docs', ['ha'], NOW)).toThrow(RoleHierarchyError)
    })

    it('adds no one when one of them is not in the server', () => {
        expect(() => planGrantRole(as(binh), 'docs', ['dung', 'ghost'], NOW)).toThrow(MemberNotFoundError)
    })

    it('skips those who have it already, whatever their rank', () => {
        const state = { ...as(binh), targets: [...everybody.filter((m) => m !== dung), member('dung', ['docs'])] }
        expect(planGrantRole(state, 'docs', ['dung'], NOW)).toEqual([])
        const higher = { ...as(binh), targets: [member('tuan', ['admin', 'docs']), dung] }
        expect(planGrantRole(higher, 'docs', ['tuan', 'dung'], NOW)).toEqual([
            { kind: 'grantRole', roleId: 'docs', userIds: ['dung'] }
        ])
    })

    it('needs every bit of the role, and a role below their highest', () => {
        expect(() => planGrantRole(as(binh), 'mod', ['dung'], NOW)).toThrow(MissingPermissionError)
        expect(() => planGrantRole(as(binh), 'lead', ['dung'], NOW)).toThrow(RoleHierarchyError)
        expect(() => planGrantRole(as(an), 'everyone', ['dung'], NOW)).toThrow(RoleRuleError)
    })
})

describe('planRevokeRole', () => {
    it('takes a role back from someone below them', () => {
        expect(planRevokeRole(as(an), 'mod', 'chi', NOW)).toEqual([
            { kind: 'revokeRole', roleId: 'mod', userId: 'chi' }
        ])
    })

    it('writes nothing when they lack it', () => {
        expect(planRevokeRole(as(binh), 'docs', 'dung', NOW)).toEqual([])
    })

    it('lets them take a lower role from themselves', () => {
        const state = { ...as(binh), targets: [member('binh', ['lead', 'docs'])] }
        expect(planRevokeRole(state, 'docs', 'binh', NOW)).toHaveLength(1)
    })

    it('refuses someone level or above, and someone not in the server', () => {
        const state = { ...as(binh), targets: [...everybody, member('tuan2', ['admin', 'docs'])] }
        expect(() => planRevokeRole(state, 'docs', 'tuan2', NOW)).toThrow(RoleHierarchyError)
        expect(() => planRevokeRole(as(binh), 'docs', 'ghost', NOW)).toThrow(MemberNotFoundError)
    })
})
