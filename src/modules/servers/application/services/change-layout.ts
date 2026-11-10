import { Inject } from '@nestjs/common'
import { PERMISSION_CACHE, PermissionCachePort } from '@/modules/permissions'
import {
    LayoutState,
    LayoutWrite,
    SERVER_REPOSITORY,
    ServerChanges,
    ServerNotFoundError,
    ServerRepositoryPort
} from '../../domain'

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
 * What every change to the server and its channel list does around its own
 * rule: run it in the locked transaction (ServerRepositoryPort.changeLayout),
 * answer NOT_FOUND when the server is gone or they are not in it, and tell
 * the permission cache after the commit when a write changed what it holds
 * (D-146). The writes decide, not the handler, so a new command cannot
 * forget (D-157).
 */
export abstract class ChangeLayout {
    constructor(
        @Inject(SERVER_REPOSITORY) private readonly servers: ServerRepositoryPort,
        @Inject(PERMISSION_CACHE) private readonly cache: PermissionCachePort
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
        return result
    }
}
