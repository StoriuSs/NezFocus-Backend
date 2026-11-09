import { AccessMember, channelPermissions, Permission, serverPermissions } from '@/modules/permissions'
import {
    freeNameProblem,
    MAX_CHANNELS_AND_CATEGORIES,
    normaliseFreeName,
    normaliseTextChannelName,
    textChannelNameProblem
} from './channel-name.rules'
import { ChannelSnapshot, ServerSnapshot } from './member-view'
import { nameKey } from './name-key'
import { CategoryNotFoundError, ChannelNotFoundError, LayoutRuleError, MissingPermissionError } from './server.errors'

/*
 * Categories and channels of one server (REQ-SRV-02, D-84, D-149): every
 * change is decided here, by a pure function, from the server and the member
 * as read inside the write's transaction with the server row locked. What it
 * returns is the list of writes; the repository only carries them out. Two
 * changes to one server therefore never decide on the same snapshot.
 */

/** The server and the person changing it, as read under the lock. */
export interface LayoutState {
    server: ServerSnapshot
    member: AccessMember
}

export type ChannelType = 'text' | 'voice'
export type SendMode = 'everyone' | 'managers'

/** A channel to make, as typed in "Create channel" (S-SRV-05). */
export interface ChannelDraft {
    type: ChannelType
    name: string
    /** Null: above the first category. */
    categoryId: string | null
    /** Voice rooms only (D-45). */
    isStudyRoom: boolean
    isPrivate: boolean
    /** Only for a private channel; never @everyone. */
    viewRoleIds: string[]
}

/** What "Channel settings" (S-SET-05) changes; anything left out stays. */
export interface ChannelEdit {
    name?: string
    /** Text channels only. */
    sendMode?: SendMode
    isPrivate?: boolean
    viewRoleIds?: string[]
}

/** One drop (D-149): it goes right after `afterId`, or first when that is null. */
export type LayoutMove =
    | { kind: 'channel'; id: string; categoryId: string | null; afterId: string | null }
    | { kind: 'category'; id: string; afterId: string | null }

export interface NewChannel {
    categoryId: string | null
    type: ChannelType
    name: string
    nameKey: string
    position: number
    isStudyRoom: boolean
    isPrivate: boolean
    viewRoleIds: string[]
}

export interface ChannelChanges {
    name?: string
    nameKey?: string
    sendMode?: SendMode
    isPrivate?: boolean
    /** Replaces the whole set. */
    viewRoleIds?: string[]
}

/** The server row itself (S-SET-01): its name, its welcome channel (null: none). */
export interface ServerChanges {
    name?: string
    welcomeChannelId?: string | null
}

export type LayoutWrite =
    | { kind: 'updateServer'; changes: ServerChanges }
    | { kind: 'createCategory'; name: string; nameKey: string; position: number }
    | { kind: 'renameCategory'; id: string; name: string; nameKey: string }
    | { kind: 'deleteCategory'; id: string }
    | { kind: 'createChannel'; channel: NewChannel }
    | { kind: 'updateChannel'; id: string; changes: ChannelChanges }
    | { kind: 'deleteChannel'; id: string }
    | { kind: 'placeChannels'; places: { id: string; categoryId: string | null; position: number }[] }
    | { kind: 'placeCategories'; places: { id: string; position: number }[] }

// --- Who may ---------------------------------------------------------------

const accessOf = (server: ServerSnapshot) => ({
    ownerId: server.ownerId,
    roles: server.roles,
    channels: server.channels
})

/** MANAGE_CHANNELS in the server: categories, and new channels. */
function requireManageServer({ server, member }: LayoutState, now: Date): void {
    const granted = serverPermissions(accessOf(server), member, now)
    if ((granted & Permission.MANAGE_CHANNELS) === 0n) throw new MissingPermissionError('MANAGE_CHANNELS')
}

/** Whether they can see the channel at all (a private one without their role: no). */
function sees({ server, member }: LayoutState, channel: ChannelSnapshot, now: Date): boolean {
    return channelPermissions(accessOf(server), member, channel, now) !== 0n
}

/** The channel, if they see it and hold MANAGE_CHANNELS in it. */
function requireManageChannel(state: LayoutState, channelId: string, now: Date): ChannelSnapshot {
    const channel = state.server.channels.find((c) => c.id === channelId)
    if (!channel) throw new ChannelNotFoundError(channelId)
    const granted = channelPermissions(accessOf(state.server), state.member, channel, now)
    if (granted === 0n) throw new ChannelNotFoundError(channelId)
    if ((granted & Permission.MANAGE_CHANNELS) === 0n) throw new MissingPermissionError('MANAGE_CHANNELS')
    return channel
}

function requireCategory(state: LayoutState, categoryId: string) {
    const category = state.server.categories.find((c) => c.id === categoryId)
    if (!category) throw new CategoryNotFoundError(categoryId)
    return category
}

// --- Names and groups ------------------------------------------------------

/** The name as stored, with its key; refused when nothing usable is left. */
function channelName(type: ChannelType, typed: string): { name: string; nameKey: string } {
    const name = type === 'text' ? normaliseTextChannelName(typed) : normaliseFreeName(typed)
    const problem = type === 'text' ? textChannelNameProblem(name) : freeNameProblem(name)
    if (problem) throw new LayoutRuleError('name_invalid', { problem })
    return { name, nameKey: nameKey(name) }
}

function categoryName(typed: string): { name: string; nameKey: string } {
    const name = normaliseFreeName(typed)
    if (freeNameProblem(name)) throw new LayoutRuleError('name_invalid', { problem: 'length' })
    return { name, nameKey: nameKey(name) }
}

const byPosition = <T extends { position: number; id: string }>(a: T, b: T) =>
    a.position - b.position || a.id.localeCompare(b.id)

/** The channels of one group (a category, or none), in order. */
const groupOf = (server: ServerSnapshot, categoryId: string | null) =>
    server.channels.filter((c) => c.categoryId === categoryId).sort(byPosition)

const nextPosition = (items: { position: number }[]) => items.reduce((top, item) => Math.max(top, item.position + 1), 0)

/** Another channel of that kind in that group already has the name (D-84). */
function clashesInGroup(
    server: ServerSnapshot,
    categoryId: string | null,
    type: ChannelType,
    key: string,
    exceptId?: string
): boolean {
    return server.channels.some(
        (c) => c.id !== exceptId && c.categoryId === categoryId && c.type === type && nameKey(c.name) === key
    )
}

function requireRoom(server: ServerSnapshot): void {
    if (server.categories.length + server.channels.length >= MAX_CHANNELS_AND_CATEGORIES) {
        throw new LayoutRuleError('limit')
    }
}

/** The roles that will see a channel: none when public; real, non-@everyone roles when private. */
function viewRoles(server: ServerSnapshot, isPrivate: boolean, ids: string[]): string[] {
    if (!isPrivate) {
        if (ids.length > 0) throw new LayoutRuleError('view_roles')
        return []
    }
    const allowed = new Set(server.roles.filter((role) => !role.isEveryone).map((role) => role.id))
    const unique = [...new Set(ids)]
    if (unique.some((id) => !allowed.has(id))) throw new LayoutRuleError('view_roles')
    return unique
}

// --- Categories ------------------------------------------------------------

/** A category at the end of the list (S-SRV-05 `category`). */
export function planCreateCategory(state: LayoutState, typed: string, now: Date): LayoutWrite[] {
    requireManageServer(state, now)
    requireRoom(state.server)
    const { name, nameKey: key } = categoryName(typed)
    if (state.server.categories.some((c) => nameKey(c.name) === key)) throw new LayoutRuleError('name_taken')
    return [{ kind: 'createCategory', name, nameKey: key, position: nextPosition(state.server.categories) }]
}

export function planRenameCategory(state: LayoutState, categoryId: string, typed: string, now: Date): LayoutWrite[] {
    requireManageServer(state, now)
    const category = requireCategory(state, categoryId)
    const { name, nameKey: key } = categoryName(typed)
    if (state.server.categories.some((c) => c.id !== categoryId && nameKey(c.name) === key)) {
        throw new LayoutRuleError('name_taken')
    }
    return name === category.name ? [] : [{ kind: 'renameCategory', id: categoryId, name, nameKey: key }]
}

/**
 * Its channels move, in order, to the end of those outside any category; then
 * it goes (REQ-SRV-02). Refused when one of them has the name of a channel of
 * its kind already out there (D-84): `names` lists the ones they can see, to
 * rename first.
 */
export function planDeleteCategory(state: LayoutState, categoryId: string, now: Date): LayoutWrite[] {
    requireManageServer(state, now)
    requireCategory(state, categoryId)
    const moving = groupOf(state.server, categoryId)
    const clashing = moving.filter((c) => clashesInGroup(state.server, null, c.type, nameKey(c.name)))
    if (clashing.length > 0) {
        throw new LayoutRuleError('name_taken', {
            names: clashing.filter((c) => sees(state, c, now)).map((c) => c.name)
        })
    }
    let position = nextPosition(groupOf(state.server, null))
    const places = moving.map((c) => ({ id: c.id, categoryId: null, position: position++ }))
    return [
        ...(places.length > 0 ? [{ kind: 'placeChannels' as const, places }] : []),
        { kind: 'deleteCategory', id: categoryId }
    ]
}

// --- Channels --------------------------------------------------------------

/** A channel at the end of its group (S-SRV-05). */
export function planCreateChannel(state: LayoutState, draft: ChannelDraft, now: Date): LayoutWrite[] {
    requireManageServer(state, now)
    if (draft.categoryId !== null) requireCategory(state, draft.categoryId)
    requireRoom(state.server)
    if (draft.isStudyRoom && draft.type !== 'voice') throw new LayoutRuleError('not_for_type')

    const { name, nameKey: key } = channelName(draft.type, draft.name)
    if (clashesInGroup(state.server, draft.categoryId, draft.type, key)) throw new LayoutRuleError('name_taken')

    return [
        {
            kind: 'createChannel',
            channel: {
                categoryId: draft.categoryId,
                type: draft.type,
                name,
                nameKey: key,
                position: nextPosition(groupOf(state.server, draft.categoryId)),
                isStudyRoom: draft.isStudyRoom,
                isPrivate: draft.isPrivate,
                viewRoleIds: viewRoles(state.server, draft.isPrivate, draft.viewRoleIds)
            }
        }
    ]
}

/** One save of "Channel settings" (S-SET-05). Nothing that differs: no write. */
export function planUpdateChannel(state: LayoutState, channelId: string, edit: ChannelEdit, now: Date): LayoutWrite[] {
    const channel = requireManageChannel(state, channelId, now)
    const changes: ChannelChanges = {}

    if (edit.name !== undefined) {
        const { name, nameKey: key } = channelName(channel.type, edit.name)
        if (clashesInGroup(state.server, channel.categoryId, channel.type, key, channel.id)) {
            throw new LayoutRuleError('name_taken')
        }
        if (name !== channel.name) Object.assign(changes, { name, nameKey: key })
    }

    if (edit.sendMode !== undefined && edit.sendMode !== channel.sendMode) {
        if (channel.type !== 'text') throw new LayoutRuleError('not_for_type')
        changes.sendMode = edit.sendMode
    }

    if (edit.isPrivate !== undefined || edit.viewRoleIds !== undefined) {
        const isPrivate = edit.isPrivate ?? channel.isPrivate
        const ids = edit.viewRoleIds ?? (isPrivate ? channel.viewRoleIds : [])
        const roles = viewRoles(state.server, isPrivate, ids)
        const sameRoles =
            roles.length === channel.viewRoleIds.length && roles.every((id) => channel.viewRoleIds.includes(id))
        if (isPrivate !== channel.isPrivate) changes.isPrivate = isPrivate
        if (!sameRoles) changes.viewRoleIds = roles
    }

    return Object.keys(changes).length === 0 ? [] : [{ kind: 'updateChannel', id: channelId, changes }]
}

/** Deleted with whatever it holds; the welcome channel's server then sends none (D-83). */
export function planDeleteChannel(state: LayoutState, channelId: string, now: Date): LayoutWrite[] {
    requireManageChannel(state, channelId, now)
    return [{ kind: 'deleteChannel', id: channelId }]
}

// --- Order (S-SRV-06, D-149) -----------------------------------------------

/** `list` with `item` put right after `afterId` (first when null), numbered from 0; only the rows that move. */
function placeAfter<T extends { id: string; position: number }>(list: T[], item: T, afterId: string | null) {
    const rest = list.filter((entry) => entry.id !== item.id)
    const index = afterId === null ? 0 : rest.findIndex((entry) => entry.id === afterId) + 1
    if (index === 0 && afterId !== null) throw new LayoutRuleError('stale_move')
    return [...rest.slice(0, index), item, ...rest.slice(index)]
}

/**
 * A channel dropped right after another of the target group, or first in it.
 * The drop place must be a channel they can see in that group now: anything
 * else means the list changed under them (`stale_move`). Channels they cannot
 * see stay where they are. Within its own group a move is never refused for
 * its name; into another, the name must be free there (D-84).
 */
function planMoveChannel(state: LayoutState, move: Extract<LayoutMove, { kind: 'channel' }>, now: Date): LayoutWrite[] {
    const channel = requireManageChannel(state, move.id, now)
    if (move.categoryId !== null) requireCategory(state, move.categoryId)

    const target = groupOf(state.server, move.categoryId)
    if (move.afterId !== null) {
        const after = target.find((c) => c.id === move.afterId)
        if (!after || after.id === channel.id || !sees(state, after, now)) throw new LayoutRuleError('stale_move')
    }
    if (move.categoryId !== channel.categoryId) {
        if (clashesInGroup(state.server, move.categoryId, channel.type, nameKey(channel.name))) {
            throw new LayoutRuleError('name_taken')
        }
    }

    const places = placeAfter(target, channel, move.afterId)
        .map((c, position) => ({ id: c.id, categoryId: move.categoryId, position }))
        .filter((place) => {
            const before = state.server.channels.find((c) => c.id === place.id)!
            return before.position !== place.position || before.categoryId !== place.categoryId
        })
    return places.length === 0 ? [] : [{ kind: 'placeChannels', places }]
}

/** A category dropped right after another, or first; channels outside any always stay above them all. */
function planMoveCategory(
    state: LayoutState,
    move: Extract<LayoutMove, { kind: 'category' }>,
    now: Date
): LayoutWrite[] {
    requireManageServer(state, now)
    const category = requireCategory(state, move.id)

    const places = placeAfter([...state.server.categories].sort(byPosition), category, move.afterId)
        .map((c, position) => ({ id: c.id, position }))
        .filter((place) => state.server.categories.find((c) => c.id === place.id)!.position !== place.position)
    return places.length === 0 ? [] : [{ kind: 'placeCategories', places }]
}

export function planMove(state: LayoutState, move: LayoutMove, now: Date): LayoutWrite[] {
    return move.kind === 'channel' ? planMoveChannel(state, move, now) : planMoveCategory(state, move, now)
}
