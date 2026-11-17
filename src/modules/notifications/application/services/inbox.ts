import { Inject } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'
import { channelPermissions, Permission, PERMISSION_CHECKER, PermissionCheckerPort } from '@/modules/permissions'
import { MEMBERSHIP, MembershipPort } from '@/modules/servers'
import { USER_DIRECTORY, UserDirectoryPort } from '@/modules/users'
import { NOTIFICATION_REPOSITORY, NotificationRepositoryPort, RemovedNotification } from '../../domain'
import { MESSAGE_PREVIEWS, MessagePreviewsPort } from '../ports'
import { NotificationViewSources } from './notification-views'

/** How many people's unread counts are read at once, so a large delete leaves the database pool to the requests. */
const COUNTS_AT_ONCE = 10

/** One person's items taken off, and their unread count when it dropped. */
export interface RemovedEntry {
    userId: string
    ids: string[]
    unreadCount: number | null
}

/**
 * What the inbox's handlers read (D-157, D-190): the items, which channels
 * someone views now (REQ-NOTIF-03), the messages and pictures items show;
 * and the event bus, for `notification.*`.
 */
export abstract class Inbox {
    constructor(
        @Inject(NOTIFICATION_REPOSITORY) protected readonly notifications: NotificationRepositoryPort,
        @Inject(MEMBERSHIP) private readonly membership: MembershipPort,
        @Inject(PERMISSION_CHECKER) private readonly checker: PermissionCheckerPort,
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(MESSAGE_PREVIEWS) private readonly previews: MessagePreviewsPort,
        protected readonly eventBus: EventBus
    ) {}

    protected get viewSources(): NotificationViewSources {
        return { users: this.users, previews: this.previews }
    }

    /**
     * The channels whose items the person sees (REQ-NOTIF-03): those they view
     * now in the servers they are in. Reads the permission cache once per
     * server, so the page and the unread count filter alike in one query
     * each. A server left or deleted gives none; one rejoined gives its items
     * back, read or not as they were.
     */
    protected async channelsOf(userId: string, now: Date): Promise<string[]> {
        const servers = await this.membership.serverIdsOf(userId)
        const accesses = await Promise.all(servers.map((serverId) => this.checker.access(serverId, userId)))
        return accesses.flatMap((access) =>
            access
                ? access.server.channels
                      .filter(
                          (channel) =>
                              (channelPermissions(access.server, access.member, channel, now) &
                                  Permission.VIEW_CHANNEL) !==
                              0n
                      )
                      .map((channel) => channel.id)
                : []
        )
    }

    /** The person's unread count, as the badge shows it (REQ-NOTIF-01). */
    protected async unreadCountOf(userId: string, now: Date): Promise<number> {
        return this.notifications.unreadCount(userId, await this.channelsOf(userId, now))
    }

    /** Items taken off, by person; a new count only for those who lost an unread one. */
    protected async removedEntries(removed: RemovedNotification[], now: Date): Promise<RemovedEntry[]> {
        const byUser = new Map<string, { ids: string[]; unread: boolean }>()
        for (const { id, userId, unread } of removed) {
            const entry = byUser.get(userId) ?? { ids: [], unread: false }
            entry.ids.push(id)
            entry.unread ||= unread
            byUser.set(userId, entry)
        }
        // A few people at a time: an @everyone message deleted is hundreds of counts.
        const entries: RemovedEntry[] = []
        const people = [...byUser]
        for (let start = 0; start < people.length; start += COUNTS_AT_ONCE) {
            entries.push(
                ...(await Promise.all(
                    people.slice(start, start + COUNTS_AT_ONCE).map(async ([userId, { ids, unread }]) => ({
                        userId,
                        ids,
                        unreadCount: unread ? await this.unreadCountOf(userId, now) : null
                    }))
                ))
            )
        }
        return entries
    }
}
