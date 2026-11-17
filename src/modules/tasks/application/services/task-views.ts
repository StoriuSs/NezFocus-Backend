import { UserDirectoryPort } from '@/modules/users'
import { TaskEventKind, TaskEventRecord, TaskPerson, TaskRecord, TaskStatus } from '../../domain'

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
    creator: TaskPersonView
    /** In the order they were given the task. */
    assignees: (TaskPersonView & { assignedAt: Date })[]
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
 * The records as the API and `task.*` give them. The commands and the
 * queries build them here alike, so a task reads the same however it came
 * (D-191).
 */
export async function taskViews(users: UserDirectoryPort, records: TaskRecord[]): Promise<TaskView[]> {
    const view = await personViews(
        users,
        records.flatMap((record) => [record.creator, ...record.assignees.map((assignee) => assignee.person)])
    )
    return records.map(({ creator, assignees, ...task }) => ({
        ...task,
        creator: view(creator),
        assignees: assignees.map(({ person, assignedAt }) => ({ ...view(person), assignedAt }))
    }))
}

/** One task as a view. */
export const taskView = async (users: UserDirectoryPort, record: TaskRecord): Promise<TaskView> =>
    (await taskViews(users, [record]))[0]!

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
