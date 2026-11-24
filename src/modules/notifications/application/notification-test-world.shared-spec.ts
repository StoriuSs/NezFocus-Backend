import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { MembershipPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import {
    FriendItemType,
    HeldMessageItem,
    InboxScope,
    MessageItemsPlan,
    MessagePlace,
    NotificationRecord,
    NotificationRepositoryPort,
    RemovedNotification,
    ServerItemDraft,
    TaskItemDraft,
    TaskPlace,
    TaskReminder
} from '../domain'
import { BlockListPort, MessagePreview, MessagePreviewsPort } from './ports'

/*
 * One server for the notifications handler specs, in memory (spec 06):
 * "ot", An the owner, Bình a member, Chi holding "Quản lý". Channels:
 * #hoi-dap, #bi-mat private to Quản lý. Lan is in no server. Server "cu" is
 * one Bình left: his items there are hidden, not deleted, but for moderation.
 */

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'quan-ly', permissions: Permission.MANAGE_MESSAGES, position: 1, isEveryone: false }
    ],
    channels: [
        {
            id: 'hoi-dap',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: false
        },
        {
            id: 'bi-mat',
            type: 'text',
            isPrivate: true,
            viewRoleIds: ['quan-ly'],
            sendMode: 'everyone',
            taskBoardEnabled: false
        }
    ]
}

const MEMBERS = ['an', 'binh', 'chi']

type Row = NotificationRecord & { actorId: string | null }

/** The inbox, kept as the Prisma repository keeps it; ids rise like UUIDv7. */
export function notificationWorld() {
    const rows: Row[] = []
    /** Tasks deleted: writing their items fails as the foreign key does. */
    const deletedTasks = new Set<string>()
    /** Servers deleted for good: writing their items fails as the foreign key does. */
    const deletedServers = new Set<string>()
    /** Accounts deleted for good (User.deletedAt set). */
    const deletedAccounts = new Set<string>()
    let made = 0
    const nextId = () => `n${String(++made).padStart(3, '0')}`
    const person = (id: string) => ({ id, username: id, displayName: id.toUpperCase(), avatarKey: `${id}.png` })
    const removeIds = (ids: string[]): RemovedNotification[] => {
        const removed: RemovedNotification[] = []
        for (const id of ids) {
            const index = rows.findIndex((row) => row.id === id)
            if (index < 0) continue
            const [row] = rows.splice(index, 1)
            removed.push({ id: row!.id, userId: row!.userId, unread: row!.readAt === null })
        }
        return removed
    }
    /** What the Prisma repository's `inScope` keeps (REQ-NOTIF-03). */
    const seen = (userId: string, { serverIds, channelIds, hiddenActorIds }: InboxScope) =>
        rows.filter(
            (row) =>
                row.userId === userId &&
                (row.actorId === null || !hiddenActorIds.includes(row.actorId) || row.type === 'owner_transferred') &&
                ((row.channelId !== null && channelIds.includes(row.channelId)) ||
                    (row.type === 'owner_transferred' && row.serverId !== null && serverIds.includes(row.serverId)) ||
                    row.type === 'moderation' ||
                    row.type === 'friend_request' ||
                    row.type === 'friend_accepted' ||
                    row.type === 'missed_call')
        )

    const repository: NotificationRepositoryPort = {
        heldForMessage: jest.fn(
            async (channelId: string, messageId: string): Promise<HeldMessageItem[]> =>
                rows
                    .filter((row) => row.channelId === channelId && row.messageId === messageId)
                    .map((row) => ({
                        id: row.id,
                        userId: row.userId,
                        type: row.type === 'reply' ? 'reply' : 'mention',
                        reason: row.reason,
                        roleId: row.roleId
                    }))
        ),
        applyMessagePlan: jest.fn(
            async (place: MessagePlace, plan: MessageItemsPlan, readerIds: ReadonlySet<string>, at: Date) => {
                const added: Row[] = []
                for (const item of plan.add) {
                    if (rows.some((row) => row.userId === item.userId && row.messageId === place.messageId)) continue
                    const row: Row = {
                        id: nextId(),
                        userId: item.userId,
                        type: item.type,
                        serverId: place.serverId,
                        channelId: place.channelId,
                        messageId: place.messageId,
                        taskId: null,
                        task: null,
                        server: null,
                        actorId: place.actorId,
                        actor: person(place.actorId),
                        reason: item.reason,
                        roleId: item.roleId,
                        note: null,
                        readAt: readerIds.has(item.userId) ? at : null,
                        createdAt: at
                    }
                    rows.push(row)
                    added.push(row)
                }
                for (const change of plan.change) {
                    const row = rows.find((candidate) => candidate.id === change.id)!
                    Object.assign(row, { type: change.type, reason: change.reason, roleId: change.roleId })
                }
                return { added: [...added].reverse(), removed: removeIds(plan.remove) }
            }
        ),
        addTaskItems: jest.fn(async ({ type, place, actorId, facts }: TaskItemDraft, userIds: string[], at: Date) => {
            // A task deleted meanwhile takes its items with it.
            if (deletedTasks.has(place.taskId)) return []
            const added = userIds.map(
                (userId): Row => ({
                    id: nextId(),
                    userId,
                    type,
                    ...place,
                    messageId: null,
                    actorId,
                    actor: actorId ? person(actorId) : null,
                    reason: null,
                    roleId: null,
                    task: facts,
                    server: null,
                    note: null,
                    readAt: null,
                    createdAt: at
                })
            )
            rows.push(...added)
            return [...added].reverse()
        }),
        addServerItem: jest.fn(
            async ({ type, serverId, actorId, facts }: ServerItemDraft, userId: string, at: Date, read: boolean) => {
                if (deletedServers.has(serverId)) return null
                const row: Row = {
                    id: nextId(),
                    userId,
                    type,
                    serverId,
                    channelId: null,
                    messageId: null,
                    taskId: null,
                    actorId,
                    actor: actorId ? person(actorId) : null,
                    reason: null,
                    roleId: null,
                    task: null,
                    server: facts,
                    note: null,
                    readAt: read ? at : null,
                    createdAt: at
                }
                rows.push(row)
                return row
            }
        ),
        remindedAlready: jest.fn(
            async ({ taskId }: TaskPlace, reminder: TaskReminder, dueAt: Date, userIds: string[]) =>
                rows
                    .filter(
                        (row) =>
                            row.taskId === taskId &&
                            row.type === 'task_reminder' &&
                            row.task?.reminder === reminder &&
                            row.task.dueAt?.getTime() === dueAt.getTime() &&
                            userIds.includes(row.userId)
                    )
                    .map((row) => row.userId)
        ),
        removeForMessages: jest.fn(async (channelId: string, messageIds: string[]) =>
            removeIds(
                rows
                    .filter((row) => row.channelId === channelId && messageIds.includes(row.messageId ?? ''))
                    .map((row) => row.id)
            )
        ),
        markReadUpTo: jest.fn(async (userId: string, channelId: string, messageId: string, at: Date) => {
            const marked = rows.filter(
                (row) =>
                    row.userId === userId &&
                    row.channelId === channelId &&
                    (row.type === 'mention' || row.type === 'reply' || row.type === 'missed_call') &&
                    row.messageId! <= messageId &&
                    row.readAt === null
            )
            marked.forEach((row) => (row.readAt = at))
            return marked.map((row) => row.id)
        }),
        markRemovalsRead: jest.fn(async (userId: string, serverId: string, at: Date) => {
            const marked = rows.filter(
                (row) =>
                    row.userId === userId &&
                    row.serverId === serverId &&
                    row.type === 'moderation' &&
                    (row.server?.action === 'kick' || row.server?.action === 'ban') &&
                    row.readAt === null
            )
            marked.forEach((row) => (row.readAt = at))
            return marked.map((row) => row.id)
        }),
        markRead: jest.fn(async (userId: string, ids: string[], at: Date) => {
            const marked = rows.filter((row) => row.userId === userId && ids.includes(row.id) && row.readAt === null)
            marked.forEach((row) => (row.readAt = at))
            return marked.map((row) => row.id)
        }),
        markAllRead: jest.fn(async (userId: string, beforeId: string, at: Date) => {
            const marked = rows.filter((row) => row.userId === userId && row.id <= beforeId && row.readAt === null)
            marked.forEach((row) => (row.readAt = at))
            return marked.length
        }),
        page: jest.fn(async (userId: string, scope: InboxScope, beforeId: string | null, limit: number) => {
            const older = seen(userId, scope)
                .filter((row) => beforeId === null || row.id < beforeId)
                .sort((a, b) => (a.id < b.id ? 1 : -1))
            return { items: older.slice(0, limit), more: older.length > limit }
        }),
        unreadCount: jest.fn(
            async (userId: string, scope: InboxScope) => seen(userId, scope).filter((row) => row.readAt === null).length
        ),
        removeOlderThan: jest.fn(
            async (cutoff: Date, limit: number) =>
                removeIds(
                    rows
                        .filter((row) => row.createdAt < cutoff)
                        .slice(0, limit)
                        .map((row) => row.id)
                ).length
        ),
        removeAllOfDeleted: jest.fn(
            async (userId: string) =>
                removeIds(
                    rows.filter((row) => row.userId === userId && deletedAccounts.has(userId)).map((row) => row.id)
                ).length
        ),
        addFriendItem: jest.fn(
            async (type: FriendItemType, userId: string, actorId: string, note: string | null, at: Date) => {
                if (deletedAccounts.has(userId) || deletedAccounts.has(actorId)) return null
                const row: Row = {
                    id: nextId(),
                    userId,
                    type,
                    serverId: null,
                    channelId: null,
                    messageId: null,
                    taskId: null,
                    actorId,
                    actor: person(actorId),
                    reason: null,
                    roleId: null,
                    task: null,
                    server: null,
                    note,
                    readAt: null,
                    createdAt: at
                }
                rows.push(row)
                return row
            }
        ),
        addMissedCallItem: jest.fn(
            async (userId: string, actorId: string, channelId: string, messageId: string, at: Date) => {
                if (deletedAccounts.has(userId) || deletedAccounts.has(actorId)) return null
                const row: Row = {
                    id: nextId(),
                    userId,
                    type: 'missed_call',
                    serverId: null,
                    channelId,
                    messageId,
                    taskId: null,
                    actorId,
                    actor: person(actorId),
                    reason: null,
                    roleId: null,
                    task: null,
                    server: null,
                    note: null,
                    readAt: null,
                    createdAt: at
                }
                rows.push(row)
                return row
            }
        ),
        removeFriendRequests: jest.fn(async (userId: string, otherId: string) =>
            removeIds(
                rows
                    .filter(
                        (row) =>
                            row.type === 'friend_request' &&
                            ((row.userId === userId && row.actorId === otherId) ||
                                (row.userId === otherId && row.actorId === userId))
                    )
                    .map((row) => row.id)
            )
        ),
        removeOfDeleted: jest.fn(
            async (limit: number) =>
                removeIds(
                    rows
                        .filter((row) => deletedAccounts.has(row.userId))
                        .slice(0, limit)
                        .map((row) => row.id)
                ).length
        )
    }

    /** Server "cu": Bình left it; his items there are kept, not shown. */
    const servers: Record<string, string[]> = { ot: MEMBERS, cu: [] }
    const membership: MembershipPort = {
        serverIdsOf: jest.fn(async (userId: string) =>
            Object.entries(servers)
                .filter(([, members]) => members.includes(userId))
                .map(([id]) => id)
        ),
        membershipsOf: jest.fn(),
        membersAmong: jest.fn(),
        channelMembers: jest.fn(),
        sharedServers: jest.fn(),
        sharingAServer: jest.fn()
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (serverId: string, userId: string) =>
            servers[serverId]?.includes(userId)
                ? { server, member: { userId, roleIds: userId === 'chi' ? ['quan-ly'] : [], timeoutUntil: null } }
                : null
        )
    } as unknown as PermissionCheckerPort
    const users = {
        avatarUrl: jest.fn(async (key: string) => {
            if (key === 'broken.png') throw new Error('cannot sign')
            return `https://cdn/${key}`
        })
    } as unknown as UserDirectoryPort
    /** The messages items show; one not here is deleted. */
    const messages = new Map<string, MessagePreview>()
    const previews: MessagePreviewsPort = {
        previewsOf: jest.fn(async (asked: { id: string; serverId: string }[]) =>
            asked.flatMap(({ id }) => {
                const found = messages.get(id)
                return found ? [found] : []
            })
        )
    }
    const eventBus = { publish: jest.fn() } as unknown as EventBus & { publish: jest.Mock }

    /** An item as if written earlier. */
    const seed = (row: Partial<Row> & { userId: string; messageId: string | null }): Row => {
        const full: Row = {
            id: nextId(),
            type: 'mention',
            serverId: 'ot',
            channelId: 'hoi-dap',
            taskId: null,
            task: null,
            server: null,
            note: null,
            actorId: 'an',
            actor: person('an'),
            reason: 'user',
            roleId: null,
            readAt: null,
            createdAt: new Date(),
            ...row
        }
        rows.push(full)
        return full
    }
    const say = (id: string, content = `tin ${id}`) =>
        messages.set(id, { id, content, mentionUsers: [], mentionRoles: [], files: { count: 0, images: 0 } })

    /** Who blocked whom: blocker → blocked. */
    const blocked = new Map<string, Set<string>>()
    const block = (blockerId: string, blockedId: string) =>
        blocked.set(blockerId, new Set([...(blocked.get(blockerId) ?? []), blockedId]))
    const blocks: BlockListPort = {
        blockedBy: jest.fn(async (userId: string) => [...(blocked.get(userId) ?? [])]),
        blockersAmong: jest.fn(async (blockedId: string, userIds: string[]) =>
            userIds.filter((userId) => blocked.get(userId)?.has(blockedId))
        )
    }

    const deps = [repository, membership, checker, users, previews, eventBus, blocks] as const
    const published = (type: new (...args: never[]) => unknown) =>
        eventBus.publish.mock.calls.map(([event]) => event).filter((event) => event instanceof type)

    return {
        rows,
        repository,
        membership,
        checker,
        users,
        previews,
        eventBus,
        deps,
        blocks,
        block,
        seed,
        say,
        published,
        servers,
        deletedTasks,
        deletedServers,
        deletedAccounts
    }
}
