import { EventBus } from '@nestjs/cqrs'
import { AccessServer, EVERYONE_DEFAULT_PERMISSIONS, Permission, PermissionCheckerPort } from '@/modules/permissions'
import { ChannelDirectoryPort } from '@/modules/servers'
import { UserDirectoryPort } from '@/modules/users'
import {
    MineFilter,
    NewTask,
    TaskEventDraft,
    TaskFacts,
    TaskFilter,
    TaskRecord,
    TaskRepositoryPort,
    TaskWrite
} from '../domain'

/*
 * One server for the tasks handler specs, in memory (spec 05 › thế giới N):
 * An the owner, Bình a member, Chi "Quản lý việc" (MANAGE_TASKS), Dũng a
 * member and Khánh an ADMINISTRATOR, both timed out for an hour, Lan not a
 * member. Channels: #viec-nhom with
 * its Task Board on, #hoi-dap with it off, #bi-mat private to Quản lý việc
 * (board on), a voice room. A server "cu" none of them is in any more.
 */

export const NOW = new Date()
export const IN_A_DAY = new Date(NOW.getTime() + 24 * 3600_000)

const server: AccessServer = {
    ownerId: 'an',
    roles: [
        { id: 'everyone', permissions: EVERYONE_DEFAULT_PERMISSIONS, position: 0, isEveryone: true },
        { id: 'quan-ly', permissions: Permission.MANAGE_TASKS, position: 1, isEveryone: false },
        { id: 'admin', permissions: Permission.ADMINISTRATOR, position: 2, isEveryone: false }
    ],
    channels: [
        {
            id: 'viec-nhom',
            type: 'text',
            isPrivate: false,
            viewRoleIds: [],
            sendMode: 'everyone',
            taskBoardEnabled: true
        },
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
            taskBoardEnabled: true
        },
        { id: 'phong', type: 'voice', isPrivate: false, viewRoleIds: [], sendMode: 'everyone', taskBoardEnabled: false }
    ]
}

const MEMBERS = ['an', 'binh', 'chi', 'dung', 'khanh']

const person = (id: string) => ({ id, username: id, displayName: id.toUpperCase(), avatarKey: null })

/** The tasks, their people and history, kept as the Prisma repository keeps them. */
export function taskWorld() {
    const tasks = new Map<string, TaskRecord & { creatorId: string }>()
    const history = new Map<string, { actorId: string | null; event: TaskEventDraft }[]>()
    let made = 0

    const factsOf = (task: TaskRecord & { creatorId: string }): TaskFacts => ({
        id: task.id,
        channelId: task.channelId,
        creatorId: task.creatorId,
        title: task.title,
        description: task.description,
        status: task.status,
        dueAt: task.dueAt,
        assigneeIds: task.assignees.map((assignee) => assignee.person.id),
        openCount:
            task.status === 'done'
                ? [...tasks.values()].filter((other) => other.channelId === task.channelId && other.status !== 'done')
                      .length
                : null
    })
    const write = (task: TaskRecord & { creatorId: string }, actorId: string, change: TaskWrite) => {
        const { titleSearch: _search, ...columns } = change.changes
        void _search
        Object.assign(task, columns)
        task.assignees = [
            ...task.assignees.filter((assignee) => !change.removeAssigneeIds.includes(assignee.person.id)),
            ...change.addAssigneeIds.map((userId) => ({ person: person(userId), assignedAt: NOW }))
        ]
        history.get(task.id)!.push(...change.events.map((event) => ({ actorId, event })))
    }

    /** Given to the reader, or made by them and given no one (REQ-TASK-05). */
    const isMine = (task: TaskRecord & { creatorId: string }, userId: string) =>
        task.assignees.some((assignee) => assignee.person.id === userId) ||
        (task.creatorId === userId && task.assignees.length === 0)
    const mineIn = ({ userId, channelIds }: MineFilter) =>
        [...tasks.values()].filter((task) => channelIds.includes(task.channelId) && isMine(task, userId))

    const repository: TaskRepositoryPort = {
        create: jest.fn(async ({ serverId, channelId, creatorId }, draft: NewTask, decide: (open: number) => void) => {
            decide([...tasks.values()].filter((task) => task.channelId === channelId && task.status !== 'done').length)
            made += 1
            const task = {
                id: `task-${made}`,
                serverId,
                channelId,
                creatorId,
                creator: person(creatorId),
                title: draft.title,
                description: draft.description,
                status: 'todo' as const,
                dueAt: draft.dueAt,
                completedAt: null,
                createdAt: NOW,
                updatedAt: NOW,
                assignees: draft.assigneeIds.map((userId) => ({ person: person(userId), assignedAt: NOW }))
            }
            tasks.set(task.id, task)
            history.set(
                task.id,
                draft.events.map((event) => ({ actorId: creatorId, event }))
            )
            return task
        }),
        change: jest.fn(async (taskId: string, actorId: string, decide: (facts: TaskFacts) => TaskWrite | null) => {
            const task = tasks.get(taskId)
            if (!task) return null
            const change = decide(factsOf(task))
            if (change) write(task, actorId, change)
            return { record: { ...task }, changed: change !== null }
        }),
        remove: jest.fn(async (taskId: string, decide: (facts: TaskFacts) => void) => {
            const task = tasks.get(taskId)
            if (!task) return null
            const facts = factsOf(task)
            decide(facts)
            tasks.delete(taskId)
            // From the history, as the Prisma repository reads it: everyone ever added (D-200).
            const added = history
                .get(taskId)!
                .flatMap(({ event }) => (event.kind === 'assignee_added' ? [event.data.userId] : []))
            return { task: facts, peopleIds: [...new Set([task.creatorId, ...added])] }
        }),
        find: jest.fn(async (taskId: string) => tasks.get(taskId) ?? null),
        listOpen: jest.fn(async ({ channelId }: TaskFilter) =>
            [...tasks.values()].filter((task) => task.channelId === channelId && task.status !== 'done')
        ),
        countDone: jest.fn(
            async ({ channelId }: TaskFilter) =>
                [...tasks.values()].filter((task) => task.channelId === channelId && task.status === 'done').length
        ),
        listDone: jest.fn(),
        serversOfMine: jest.fn(async (userId: string) => [
            ...new Set([...tasks.values()].filter((task) => isMine(task, userId)).map((task) => task.serverId))
        ]),
        listMineOpen: jest.fn(async (filter: MineFilter) =>
            mineIn(filter)
                .filter((task) => task.status !== 'done')
                .sort(
                    (a, b) =>
                        (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || a.id.localeCompare(b.id)
                )
        ),
        countMineDone: jest.fn(
            async (filter: MineFilter) => mineIn(filter).filter((task) => task.status === 'done').length
        ),
        listMineDone: jest.fn(async (filter: MineFilter, beforeId: string | null) => {
            const done = mineIn(filter).filter((task) => task.status === 'done')
            return beforeId && !done.some((task) => task.id === beforeId) ? ('stale' as const) : done
        }),
        unassignLeftMember: jest.fn(async (serverId: string, userId: string) => {
            const changed = [...tasks.values()].filter(
                (task) => task.serverId === serverId && task.assignees.some((assignee) => assignee.person.id === userId)
            )
            for (const task of changed) {
                task.assignees = task.assignees.filter((assignee) => assignee.person.id !== userId)
                history.get(task.id)!.push({
                    actorId: null,
                    event: { kind: 'assignee_removed', data: { userId } }
                })
            }
            return changed.map((task) => ({ ...task }))
        }),
        history: jest.fn()
    }

    const channels: ChannelDirectoryPort = {
        serverIdOf: jest.fn(async (channelId: string) =>
            server.channels.some((channel) => channel.id === channelId) ? 'nd' : null
        ),
        channelIdsOf: async () => [],

        studyRoomOf: async () => null,
        namesOf: async () => ({ servers: new Map(), channels: new Map() }),
        studyRoomsAmong: async () => []
    }
    const checker: PermissionCheckerPort = {
        access: jest.fn(async (serverId: string, userId: string) =>
            serverId !== 'cu' && MEMBERS.includes(userId)
                ? {
                      server,
                      member: {
                          userId,
                          roleIds: userId === 'chi' ? ['quan-ly'] : userId === 'khanh' ? ['admin'] : [],
                          timeoutUntil: ['dung', 'khanh'].includes(userId) ? new Date(Date.now() + 3600_000) : null
                      }
                  }
                : null
        )
    }
    const users = {
        avatarUrl: jest.fn(async () => null),
        timeZoneOf: jest.fn(async () => 'Asia/Ho_Chi_Minh')
    } as unknown as UserDirectoryPort
    const events = { publish: jest.fn() }

    /** A task straight into memory, as if made earlier. */
    const seed = (extra: Partial<TaskRecord & { creatorId: string }> = {}) => {
        made += 1
        const task = {
            id: `task-${made}`,
            serverId: 'nd',
            channelId: 'viec-nhom',
            creatorId: 'an',
            creator: person(extra.creatorId ?? 'an'),
            title: 'Sửa lỗi đăng nhập',
            description: '',
            status: 'todo' as const,
            dueAt: IN_A_DAY,
            completedAt: null,
            createdAt: NOW,
            updatedAt: NOW,
            assignees: [{ person: person('binh'), assignedAt: NOW }],
            ...extra
        }
        tasks.set(task.id, task)
        history.set(task.id, [])
        return task.id
    }

    return {
        repository,
        channels,
        checker,
        users,
        events,
        bus: events as unknown as EventBus,
        tasks,
        history,
        seed,
        /** The constructor arguments every task handler takes, in order. */
        ports: [repository, channels, checker, users] as const
    }
}
