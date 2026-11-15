import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import {
    LayoutState,
    LayoutWrite,
    SERVER_REPOSITORY,
    ServerChanges,
    ServerNotFoundError,
    ServerRepositoryPort
} from '../../domain'
import { ServerChange, ServerChangedEvent } from '../events/server-changed.event'

/**
 * Whether each field of the server is in the permission cache (D-146 holds
 * its owner, roles and channels). A new field fails to compile until it is
 * decided here.
 */
const SERVER_FIELD_CACHED: Record<keyof ServerChanges, boolean> = { name: false, welcomeChannelId: false }

/**
 * Whether a write changes what the permission cache holds of the server:
 * each channel's type, privacy, view roles and who may post. Categories and
 * order are not in it. Every kind is decided here, so a new one fails to
 * compile rather than leave an old permission in force.
 */
const CHANGES_CACHED: { [K in LayoutWrite['kind']]: (write: Extract<LayoutWrite, { kind: K }>) => boolean } = {
    updateServer: (write) =>
        (Object.keys(write.changes) as (keyof ServerChanges)[]).some((field) => SERVER_FIELD_CACHED[field]),
    createCategory: () => false,
    renameCategory: () => false,
    deleteCategory: () => false,
    createChannel: () => true,
    updateChannel: () => true,
    deleteChannel: () => true,
    placeChannels: () => false,
    placeCategories: () => false
}

const changesCached = (write: LayoutWrite) => (CHANGES_CACHED[write.kind] as (write: LayoutWrite) => boolean)(write)

/**
 * Whether a write may change who views a channel, so realtime moves the
 * members' sockets (D-178): a channel made or deleted, or made private or
 * public, or given other view roles. Its name or who may post changes no
 * view; neither do categories and order.
 */
const CHANGES_VIEW: { [K in LayoutWrite['kind']]: (write: Extract<LayoutWrite, { kind: K }>) => boolean } = {
    updateServer: () => false,
    createCategory: () => false,
    renameCategory: () => false,
    deleteCategory: () => false,
    createChannel: () => true,
    updateChannel: (write) => write.changes.isPrivate !== undefined || write.changes.viewRoleIds !== undefined,
    deleteChannel: () => true,
    placeChannels: () => false,
    placeCategories: () => false
}

const changesView = (write: LayoutWrite) => (CHANGES_VIEW[write.kind] as (write: LayoutWrite) => boolean)(write)

/** What the members are told of each write (D-178, SRS 5.2). A move is an update of what moved. */
const TOLD: Record<LayoutWrite['kind'], ServerChange> = {
    updateServer: { topic: 'server', action: 'updated' },
    createCategory: { topic: 'category', action: 'created' },
    renameCategory: { topic: 'category', action: 'updated' },
    deleteCategory: { topic: 'category', action: 'deleted' },
    createChannel: { topic: 'channel', action: 'created' },
    updateChannel: { topic: 'channel', action: 'updated' },
    deleteChannel: { topic: 'channel', action: 'deleted' },
    placeChannels: { topic: 'channel', action: 'updated' },
    placeCategories: { topic: 'category', action: 'updated' }
}

/**
 * What every change to the server and its channel list does around its own
 * rule: run it in the locked transaction (ServerRepositoryPort.changeLayout),
 * answer NOT_FOUND when the server is gone or they are not in it, and tell
 * the permission cache after the commit when a write changed what it holds
 * (D-146), then the members (ServerChangedEvent, D-178): the cache first,
 * so what they read again is already new. The writes decide, not the
 * handler, so a new command cannot forget (D-157).
 */
export abstract class ChangeLayout {
    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort,
        private readonly events: EventBus
    ) {}

    protected async change(
        serverId: string,
        userId: string,
        decide: (state: LayoutState, now: Date) => LayoutWrite[]
    ): Promise<{ createdId: string | null }> {
        const now = new Date()
        let writes: LayoutWrite[] = []
        const result = await this.servers.changeLayout(serverId, userId, (state) => {
            writes = decide(state, now)
            return writes
        })
        if (!result) throw new ServerNotFoundError(serverId)
        if (writes.some(changesCached)) await this.cache.serverChanged(serverId)
        if (writes.length > 0) {
            const changes = writes.map((write) => TOLD[write.kind])
            this.events.publish(new ServerChangedEvent(serverId, changes, writes.some(changesView)))
        }
        return result
    }
}
