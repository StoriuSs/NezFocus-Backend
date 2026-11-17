import { PermissionCheckerPort, ServerAccess } from '@/modules/permissions'
import { UserDirectoryPort } from '@/modules/users'
import { TaskEventKind, TaskEventRecord, TaskPerson, TaskRecord, TaskStatus } from '../../domain'
import { viewsChannel } from './board-access'

/** A person a task names, the picture as an address. */
export interface TaskPersonView {
    id: string
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

/** A task as the API and the socket give it (S-TASK-01, S-TASK-02). */
export interface TaskView {
    id: string
    serverId: string
    channelId: string
    title: string
    description: string
    status: TaskStatus
    dueAt: Date | null
    completedAt: Date | null
    createdAt: Date
    updatedAt: Date
    /** `leftServer`: no longer a member of the task's server ("(đã rời server)", D-194). */
    creator: TaskPersonView & { leftServer: boolean }
    /**
     * In the order they were given the task. `viewsChannel` false: still on
     * it but no longer views its channel ("Mất quyền xem kênh", REQ-TASK-04,
     * D-194).
     */
    assignees: (TaskPersonView & { assignedAt: Date; viewsChannel: boolean })[]
}

/** What building a task's view reads: the pictures, and where its people stand now (D-194). */
export interface ViewSources {
    users: UserDirectoryPort
    checker: PermissionCheckerPort
}

/** A line of a task's history as the API gives it (REQ-TASK-03). */
export interface TaskEventView {
    id: string
    kind: TaskEventKind
    actor: TaskPersonView | null
    subject: TaskPersonView | null
    from: string | null
    to: string | null
    createdAt: Date
}

/** The picture's address, or none when it cannot be signed: a task never fails for a picture. */
async function addressOf(users: UserDirectoryPort, key: string): Promise<string | null> {
    try {
        return await users.avatarUrl(key)
    } catch {
        return null
    }
}

/** The people's pictures as addresses: one signature per picture, however many times it shows. */
async function personViews(users: UserDirectoryPort, people: (TaskPerson | null)[]) {
    const keys = [...new Set(people.map((person) => person?.avatarKey).filter((key): key is string => !!key))]
    const urls = new Map(await Promise.all(keys.map(async (key) => [key, await addressOf(users, key)] as const)))
    return (person: TaskPerson): TaskPersonView => ({
        id: person.id,
        username: person.username,
        displayName: person.displayName,
        avatarUrl: person.avatarKey ? (urls.get(person.avatarKey) ?? null) : null
    })
}

/**
 * Where the people of these tasks stand now (D-194): each person's access
 * to each server read once from the permission cache, however many tasks
 * name them.
 */
async function standingOf(checker: PermissionCheckerPort, records: TaskRecord[], now: Date) {
    const pairs = new Map<string, { serverId: string; userId: string }>()
    for (const { serverId, creator, assignees } of records) {
        for (const userId of [creator.id, ...assignees.map((assignee) => assignee.person.id)]) {
            pairs.set(`${serverId} ${userId}`, { serverId, userId })
        }
    }
    const reads = await Promise.all(
        [...pairs].map(async ([key, { serverId, userId }]) => [key, await checker.access(serverId, userId)] as const)
    )
    const access = new Map<string, ServerAccess | null>(reads)
    return {
        inServer: (serverId: string, userId: string) => !!access.get(`${serverId} ${userId}`),
        views: ({ serverId, channelId }: TaskRecord, userId: string) =>
            viewsChannel(access.get(`${serverId} ${userId}`) ?? null, channelId, now)
    }
}

/**
 * The records as the API and `task.*` give them. The commands and the
 * queries build them here alike, so a task reads the same however it came
 * (D-191).
 */
export async function taskViews(
    { users, checker }: ViewSources,
    records: TaskRecord[],
    now = new Date()
): Promise<TaskView[]> {
    const [view, standing] = await Promise.all([
        personViews(
            users,
            records.flatMap((record) => [record.creator, ...record.assignees.map((assignee) => assignee.person)])
        ),
        standingOf(checker, records, now)
    ])
    return records.map((record) => {
        const { creator, assignees, ...task } = record
        return {
            ...task,
            creator: { ...view(creator), leftServer: !standing.inServer(task.serverId, creator.id) },
            assignees: assignees.map(({ person, assignedAt }) => ({
                ...view(person),
                assignedAt,
                viewsChannel: standing.views(record, person.id)
            }))
        }
    })
}

/** One task as a view. */
export const taskView = async (sources: ViewSources, record: TaskRecord): Promise<TaskView> =>
    (await taskViews(sources, [record]))[0]!

/** History lines with their people's pictures as addresses. */
export async function taskEventViews(users: UserDirectoryPort, records: TaskEventRecord[]): Promise<TaskEventView[]> {
    const view = await personViews(
        users,
        records.flatMap((record) => [record.actor, record.subject])
    )
    return records.map(({ actor, subject, ...line }) => ({
        ...line,
        actor: actor && view(actor),
        subject: subject && view(subject)
    }))
}
