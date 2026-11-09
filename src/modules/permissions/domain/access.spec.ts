import {
    AccessChannel,
    AccessRole,
    AccessMember,
    AccessServer,
    channelPermissions,
    outranksMember,
    outranksRole,
    permissionChangeAllowed,
    roleHandoutAllowed,
    serverPermissions
} from './access'
import { ALL_PERMISSIONS, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionName } from './permission-flags'

/*
 * The permission matrix (REQ-ROLE-05, NFR-TEST-01: at least 50 cases). One
 * server, written out in full so each row reads on its own:
 *
 *   roles (rank)      admin 5 · lead 4 · mod 3 · helper 2 · voice 1 · @everyone 0
 *   channels          general (text) · staff (text, private: mod) ·
 *                     news (text, managers only) · lounge (voice) ·
 *   variants          `quiet`: @everyone lacks CONNECT · `blind`: @everyone
 *                     lacks VIEW_CHANNEL
 */
const NOW = new Date('2026-11-09T10:00:00Z')
const LATER = new Date('2026-11-09T11:00:00Z')
const EARLIER = new Date('2026-11-09T09:00:00Z')

const bits = (...names: PermissionName[]) => names.reduce((all, name) => all | Permission[name], 0n)

const server: AccessServer = {
    ownerId: 'owner',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'helper', permissions: bits('MANAGE_TASKS'), position: 2, isEveryone: false },
        {
            id: 'mod',
            permissions: bits('MANAGE_MESSAGES', 'KICK_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_ROLES'),
            position: 3,
            isEveryone: false
        },
        { id: 'lead', permissions: bits('MANAGE_CHANNELS', 'BAN_MEMBERS'), position: 4, isEveryone: false },
        { id: 'admin', permissions: bits('ADMINISTRATOR'), position: 5, isEveryone: false },
        // Gives CONNECT back in `quiet`, below.
        { id: 'voice', permissions: bits('CONNECT'), position: 1, isEveryone: false }
    ],
    channels: [
        { id: 'general', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'staff', type: 'text', isPrivate: true, viewRoleIds: ['mod'], sendMode: 'everyone' },
        { id: 'news', type: 'text', isPrivate: false, viewRoleIds: [], sendMode: 'managers' },
        { id: 'lounge', type: 'voice', isPrivate: false, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'vault', type: 'text', isPrivate: true, viewRoleIds: [], sendMode: 'everyone' },
        { id: 'open', type: 'text', isPrivate: true, viewRoleIds: ['everyone'], sendMode: 'everyone' },
        { id: 'podium', type: 'voice', isPrivate: false, viewRoleIds: [], sendMode: 'managers' }
    ]
}

/** The same server with some bits taken from @everyone. */
const without = (...names: PermissionName[]): AccessServer => ({
    ...server,
    roles: server.roles.map((role) =>
        role.isEveryone ? { ...role, permissions: EVERYONE_DEFAULT_PERMISSIONS & ~bits(...names) } : role
    )
})
const quiet = without('CONNECT')
const blind = without('VIEW_CHANNEL')

const member = (userId: string, roleIds: string[] = [], timeoutUntil: Date | null = null): AccessMember => ({
    userId,
    roleIds,
    timeoutUntil
})

const owner = member('owner')
const plain = member('plain')
const helper = member('helper', ['helper'])
const mod = member('mod', ['mod'])
const lead = member('lead', ['lead'])
const admin = member('admin', ['admin'])
const modAndHelper = member('both', ['mod', 'helper'])
const timedOut = member('t', [], LATER)
const timedOutMod = member('tm', ['mod'], LATER)
const timeoutOver = member('to', [], EARLIER)
const timedOutAdmin = member('ta', ['admin'], LATER)
const staleRole = member('stale', ['gone-role'])
const timedOutOwner = member('owner', [], LATER)

const channel = (s: AccessServer, id: string): AccessChannel => {
    const found = s.channels.find((c) => c.id === id)
    if (!found) throw new Error(`no channel ${id}`)
    return found
}

type Case = [title: string, s: AccessServer, who: AccessMember, where: string, permission: PermissionName, has: boolean]

const channelCases: Case[] = [
    // Step 1: the owner and ADMINISTRATOR have every permission.
    ['owner sends in general', server, owner, 'general', 'SEND_MESSAGES', true],
    ['owner sees the private staff channel', server, owner, 'staff', 'VIEW_CHANNEL', true],
    ['owner sends in a managers-only channel', server, owner, 'news', 'SEND_MESSAGES', true],
    ['owner has MANAGE_SERVER in any channel', server, owner, 'general', 'MANAGE_SERVER', true],
    ['owner connects where @everyone cannot', quiet, owner, 'lounge', 'CONNECT', true],
    ['admin sees the private staff channel', server, admin, 'staff', 'VIEW_CHANNEL', true],
    ['admin sends in a managers-only channel', server, admin, 'news', 'SEND_MESSAGES', true],
    ['admin has BAN_MEMBERS without the bit', server, admin, 'general', 'BAN_MEMBERS', true],
    ['admin speaks where @everyone cannot connect', quiet, admin, 'lounge', 'SPEAK', true],
    ['admin is not limited by a timeout', server, timedOutAdmin, 'general', 'SEND_MESSAGES', true],
    ['the owner is not limited by a timeout', server, timedOutOwner, 'general', 'SEND_MESSAGES', true],
    ['owner sees a private channel with no roles', server, owner, 'vault', 'VIEW_CHANNEL', true],

    // Step 2: @everyone OR every role of the member.
    ['plain member sees general', server, plain, 'general', 'VIEW_CHANNEL', true],
    ['plain member sends in general', server, plain, 'general', 'SEND_MESSAGES', true],
    ['plain member attaches files', server, plain, 'general', 'ATTACH_FILES', true],
    ['plain member adds reactions', server, plain, 'general', 'ADD_REACTIONS', true],
    ['plain member creates tasks', server, plain, 'general', 'CREATE_TASKS', true],
    ['plain member cannot mention everyone', server, plain, 'general', 'MENTION_EVERYONE', false],
    ['plain member cannot manage messages', server, plain, 'general', 'MANAGE_MESSAGES', false],
    ['plain member cannot manage channels', server, plain, 'general', 'MANAGE_CHANNELS', false],
    ['plain member creates invites', server, plain, 'general', 'CREATE_INVITE', true],
    ['helper gets MANAGE_TASKS from the role', server, helper, 'general', 'MANAGE_TASKS', true],
    ['helper still has the @everyone bits', server, helper, 'general', 'SEND_MESSAGES', true],
    ['mod has MANAGE_MESSAGES', server, mod, 'general', 'MANAGE_MESSAGES', true],
    ['mod has no MANAGE_TASKS', server, mod, 'general', 'MANAGE_TASKS', false],
    ['two roles add up: mod part', server, modAndHelper, 'general', 'KICK_MEMBERS', true],
    ['two roles add up: helper part', server, modAndHelper, 'general', 'MANAGE_TASKS', true],
    ['a role id no longer on the server adds nothing', server, staleRole, 'general', 'MANAGE_MESSAGES', false],
    ['a role id no longer on the server keeps @everyone', server, staleRole, 'general', 'SEND_MESSAGES', true],

    // Step 3: a private channel shows only to its roles (and step 1).
    ['plain member does not see staff', server, plain, 'staff', 'VIEW_CHANNEL', false],
    ['plain member cannot send in staff', server, plain, 'staff', 'SEND_MESSAGES', false],
    ['helper does not see staff', server, helper, 'staff', 'VIEW_CHANNEL', false],
    ['lead, ranked above mod, still does not see staff', server, lead, 'staff', 'VIEW_CHANNEL', false],
    ['mod sees staff', server, mod, 'staff', 'VIEW_CHANNEL', true],
    ['mod sends in staff', server, mod, 'staff', 'SEND_MESSAGES', true],
    ['mod with another role too sees staff', server, modAndHelper, 'staff', 'VIEW_CHANNEL', true],
    ['a private channel with no roles: mod does not see it', server, mod, 'vault', 'VIEW_CHANNEL', false],
    ['a private channel open to @everyone: plain member sees it', server, plain, 'open', 'VIEW_CHANNEL', true],

    // Without VIEW_CHANNEL a channel is hidden, whatever else is held.
    ['no VIEW_CHANNEL: general is hidden', blind, plain, 'general', 'VIEW_CHANNEL', false],
    ['no VIEW_CHANNEL: nothing else in it either', blind, plain, 'general', 'SEND_MESSAGES', false],
    ['no VIEW_CHANNEL: even mod powers vanish there', blind, mod, 'general', 'MANAGE_MESSAGES', false],

    // Step 4: managers-only channels.
    ['plain member reads news', server, plain, 'news', 'VIEW_CHANNEL', true],
    ['plain member cannot send in news', server, plain, 'news', 'SEND_MESSAGES', false],
    ['plain member cannot attach in news', server, plain, 'news', 'ATTACH_FILES', false],
    ['plain member keeps reactions in news', server, plain, 'news', 'ADD_REACTIONS', true],
    ['mod sends in news', server, mod, 'news', 'SEND_MESSAGES', true],
    ['mod attaches in news', server, mod, 'news', 'ATTACH_FILES', true],
    ['lead without MANAGE_MESSAGES cannot send in news', server, lead, 'news', 'SEND_MESSAGES', false],
    ['managers-only applies to a voice room chat too', server, plain, 'podium', 'SEND_MESSAGES', false],
    ['managers-only leaves speaking in a voice room', server, plain, 'podium', 'SPEAK', true],

    // Step 5: a voice room without CONNECT.
    ['plain member connects to lounge', server, plain, 'lounge', 'CONNECT', true],
    ['plain member speaks in lounge', server, plain, 'lounge', 'SPEAK', true],
    ['plain member has video in lounge', server, plain, 'lounge', 'VIDEO', true],
    ['no CONNECT: cannot speak', quiet, member('p2', []), 'lounge', 'SPEAK', false],
    ['no CONNECT: cannot use video', quiet, member('p3', []), 'lounge', 'VIDEO', false],
    ['a role that grants CONNECT gives speaking back', quiet, member('v', ['voice']), 'lounge', 'SPEAK', true],
    ['no CONNECT: still sees the room', quiet, member('p4', []), 'lounge', 'VIEW_CHANNEL', true],

    // Step 6: timed out → VIEW_CHANNEL only.
    ['timed out: still sees general', server, timedOut, 'general', 'VIEW_CHANNEL', true],
    ['timed out: cannot send', server, timedOut, 'general', 'SEND_MESSAGES', false],
    ['timed out: cannot react', server, timedOut, 'general', 'ADD_REACTIONS', false],
    ['timed out: cannot connect', server, timedOut, 'lounge', 'CONNECT', false],
    ['timed out: cannot create tasks', server, timedOut, 'general', 'CREATE_TASKS', false],
    ['timed out mod: loses MANAGE_MESSAGES', server, timedOutMod, 'general', 'MANAGE_MESSAGES', false],
    ['timed out mod: still sees staff', server, timedOutMod, 'staff', 'VIEW_CHANNEL', true],
    ['timed out: a private channel stays hidden', server, timedOut, 'staff', 'VIEW_CHANNEL', false],
    ['a timeout that ended has no effect', server, timeoutOver, 'general', 'SEND_MESSAGES', true]
]

describe('channelPermissions', () => {
    it.each(channelCases)('%s', (_title, s, who, where, permission, has) => {
        const granted = channelPermissions(s, who, channel(s, where), NOW)
        expect((granted & Permission[permission]) !== 0n).toBe(has)
    })

    it('gives the owner every permission there is', () => {
        expect(channelPermissions(server, owner, channel(server, 'staff'), NOW)).toBe(ALL_PERMISSIONS)
    })

    it('gives a member who cannot see a channel nothing at all', () => {
        expect(channelPermissions(server, plain, channel(server, 'staff'), NOW)).toBe(0n)
    })

    it('leaves a timed-out member exactly VIEW_CHANNEL', () => {
        expect(channelPermissions(server, timedOut, channel(server, 'general'), NOW)).toBe(Permission.VIEW_CHANNEL)
    })

    it('treats the moment a timeout ends as over', () => {
        const endsNow = member('e', [], NOW)
        expect(channelPermissions(server, endsNow, channel(server, 'general'), NOW)).toBe(EVERYONE_DEFAULT_PERMISSIONS)
    })
})

describe('serverPermissions', () => {
    it('gives the owner everything', () => {
        expect(serverPermissions(server, owner, NOW)).toBe(ALL_PERMISSIONS)
    })

    it('gives ADMINISTRATOR everything', () => {
        expect(serverPermissions(server, admin, NOW)).toBe(ALL_PERMISSIONS)
    })

    it('adds @everyone and every role', () => {
        expect(serverPermissions(server, modAndHelper, NOW)).toBe(
            EVERYONE_DEFAULT_PERMISSIONS |
                bits('MANAGE_MESSAGES', 'KICK_MEMBERS', 'MODERATE_MEMBERS', 'MANAGE_ROLES', 'MANAGE_TASKS')
        )
    })

    it('gives a timed-out admin everything still (step 1 comes first)', () => {
        expect(serverPermissions(server, timedOutAdmin, NOW)).toBe(ALL_PERMISSIONS)
    })

    it('ignores bits that are not permissions', () => {
        const odd: AccessServer = {
            ...server,
            roles: server.roles.map((role) =>
                role.isEveryone ? { ...role, permissions: (1n << 9n) | (1n << 40n) } : role
            )
        }
        expect(serverPermissions(odd, plain, NOW)).toBe(0n)
    })

    it('leaves a timed-out moderator only VIEW_CHANNEL, so they cannot moderate either', () => {
        expect(serverPermissions(server, timedOutMod, NOW)).toBe(Permission.VIEW_CHANNEL)
    })
})

describe('outranksMember', () => {
    it.each([
        ['the owner outranks an admin', owner, admin, true],
        ['nobody outranks the owner, not even an admin', admin, owner, false],
        ['the owner does not act on themselves', owner, owner, false],
        ['a higher role outranks a lower one', lead, mod, true],
        ['an equal rank does not', mod, member('mod2', ['mod']), false],
        ['a lower rank does not', helper, mod, false],
        ['ADMINISTRATOR does not lift the rank: admin 4 outranks lead 3', admin, lead, true],
        ['a member with no role outranks nobody', plain, member('other'), false],
        ['rank is the highest role, not the sum', modAndHelper, lead, false]
    ])('%s', (_title, actor, target, expected) => {
        expect(outranksMember(server, actor, target)).toBe(expected)
    })
})

describe('outranksRole', () => {
    const role = (id: string) => {
        const found = server.roles.find((r) => r.id === id)
        if (!found) throw new Error(id)
        return found
    }

    it.each([
        ['the owner manages the top role', owner, 'admin', true],
        ['mod manages a role below its own', mod, 'helper', true],
        ['mod does not manage its own role', mod, 'mod', false],
        ['mod does not manage a role above', mod, 'lead', false],
        ['a member with any role manages @everyone', helper, 'everyone', true],
        ['a member with no role does not manage @everyone', plain, 'everyone', false]
    ])('%s', (_title, actor, roleId, expected) => {
        expect(outranksRole(server, actor, role(roleId))).toBe(expected)
    })
})

describe('permissionChangeAllowed', () => {
    const modBits = serverPermissions(server, mod, NOW)

    it.each([
        ['granting a permission one holds', bits('KICK_MEMBERS'), true],
        ['granting one one does not hold', bits('BAN_MEMBERS'), false],
        ['granting ADMINISTRATOR without holding it', bits('ADMINISTRATOR'), false]
    ])('%s', (_title, added, expected) => {
        expect(permissionChangeAllowed(modBits, 0n, added)).toBe(expected)
    })

    it('refuses removing a permission one does not hold', () => {
        expect(permissionChangeAllowed(modBits, bits('BAN_MEMBERS', 'KICK_MEMBERS'), bits('KICK_MEMBERS'))).toBe(false)
    })

    it('allows leaving bits one does not hold untouched while changing others', () => {
        expect(permissionChangeAllowed(modBits, bits('BAN_MEMBERS'), bits('BAN_MEMBERS', 'KICK_MEMBERS'))).toBe(true)
    })

    it('does not let a stray stored bit block an edit', () => {
        expect(permissionChangeAllowed(modBits, (1n << 9n) | bits('KICK_MEMBERS'), 0n)).toBe(true)
    })

    it('lets the owner change anything', () => {
        expect(permissionChangeAllowed(ALL_PERMISSIONS, 0n, ALL_PERMISSIONS)).toBe(true)
    })
})

describe('roleHandoutAllowed', () => {
    const modBits = serverPermissions(server, mod, NOW)
    const role = (permissions: bigint): AccessRole => ({ id: 'r', permissions, position: 1, isEveryone: false })

    it.each([
        ['a role whose bits one holds', role(bits('KICK_MEMBERS')), true],
        ['a role with no bits', role(0n), true],
        ['a role carrying ADMINISTRATOR, below one but not held', role(bits('ADMINISTRATOR')), false],
        ['a role carrying one bit one lacks', role(bits('KICK_MEMBERS', 'BAN_MEMBERS')), false]
    ])('%s', (_title, target, expected) => {
        expect(roleHandoutAllowed(modBits, target)).toBe(expected)
    })

    it('lets the owner hand out any role', () => {
        expect(roleHandoutAllowed(ALL_PERMISSIONS, role(bits('ADMINISTRATOR')))).toBe(true)
    })
})
