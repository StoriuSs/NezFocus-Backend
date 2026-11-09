import { channelPermissions, Permission, serverPermissions } from '@/modules/permissions'
import { LayoutState, LayoutWrite, ServerChanges } from './channel-layout'
import { isServerName, normaliseServerName } from './server-name.rules'
import { ChannelNotFoundError, LayoutRuleError, MissingPermissionError } from './server.errors'

/** What "Overview" of the server settings may change (S-SET-01). Left out: unchanged. */
export interface ServerEdit {
    name?: string
    /** null: "Send none" (D-83). */
    welcomeChannelId?: string | null
}

/**
 * The server's name and welcome channel (REQ-SRV-01, D-83), decided under the
 * same lock as the channel list: a welcome channel chosen while someone else
 * deletes it is either chosen first (then deleted, so "Send none") or refused.
 *
 * - MANAGE_SERVER in the server.
 * - The name: 2–100 characters once composed and trimmed.
 * - The welcome channel: a text channel of this server that they can see; one
 *   they cannot see answers as if it did not exist (NFR-SEC-05). A private
 *   one they see is allowed (04 Q14): only those who see it see the greeting.
 */
export function planUpdateServer({ server, member }: LayoutState, edit: ServerEdit, now: Date): LayoutWrite[] {
    const access = { ownerId: server.ownerId, roles: server.roles, channels: server.channels }
    if ((serverPermissions(access, member, now) & Permission.MANAGE_SERVER) === 0n) {
        throw new MissingPermissionError('MANAGE_SERVER')
    }

    const changes: ServerChanges = {}
    if (edit.name !== undefined) {
        const name = normaliseServerName(edit.name)
        if (!isServerName(name)) throw new LayoutRuleError('name_invalid', { problem: 'length' })
        if (name !== server.name) changes.name = name
    }
    if (edit.welcomeChannelId !== undefined && edit.welcomeChannelId !== server.welcomeChannelId) {
        const id = edit.welcomeChannelId
        if (id !== null) {
            const channel = server.channels.find((c) => c.id === id)
            if (!channel || channelPermissions(access, member, channel, now) === 0n) throw new ChannelNotFoundError(id)
            if (channel.type !== 'text') throw new LayoutRuleError('not_for_type')
        }
        changes.welcomeChannelId = id
    }
    return Object.keys(changes).length === 0 ? [] : [{ kind: 'updateServer', changes }]
}
