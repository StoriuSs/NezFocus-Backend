import { Prisma } from '@/generated/prisma/client'
import { shownPerson } from '@/shared/domain'
import { SHOWN_PERSON } from '@/shared/infrastructure/persistence/shown-person'
import { TaskEventKind, TaskEventRecord, TaskPerson, TaskRecord } from '../../domain'

/** A person as others see them: an account deleted, or waiting to be, has no name or picture (D-182). */
export const PERSON = { select: SHOWN_PERSON } as const

/** A task as the board, its detail and `task.*` read it, its people in the order they were added. */
export const TASK = {
    id: true,
    serverId: true,
    channelId: true,
    creator: PERSON,
    title: true,
    description: true,
    status: true,
    dueAt: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    assignees: {
        select: { assignedAt: true, user: PERSON },
        // Added together, they keep one order (by id) rather than the database's.
        orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }]
    }
} satisfies Prisma.TaskSelect

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK }>
type PersonRow = Prisma.UserGetPayload<typeof PERSON>

export const toPerson = (row: PersonRow): TaskPerson => {
    const { id, username, displayName, avatarUrl } = shownPerson(row)
    return { id, username, displayName, avatarKey: avatarUrl }
}

export const toTaskRecord = (row: TaskRow): TaskRecord => ({
    id: row.id,
    serverId: row.serverId,
    channelId: row.channelId,
    creator: toPerson(row.creator),
    title: row.title,
    description: row.description,
    status: row.status,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignees: row.assignees.map(({ assignedAt, user }) => ({ person: toPerson(user), assignedAt }))
})

/** A line of history as stored, its actor read with it. */
export const TASK_EVENT = {
    id: true,
    kind: true,
    data: true,
    createdAt: true,
    actor: PERSON
} satisfies Prisma.TaskEventSelect

type TaskEventRow = Prisma.TaskEventGetPayload<{ select: typeof TASK_EVENT }>

/** What a line's `data` may hold (task.rules.ts › TaskEventDraft), read without trusting it. */
interface EventData {
    userId?: unknown
    from?: unknown
    to?: unknown
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)

/** The person an `assignee_*` line is about, if it names one. */
export const subjectIdOf = (row: Pick<TaskEventRow, 'data'>): string | null =>
    text((row.data as EventData | null)?.userId)

export const toEventRecord = (row: TaskEventRow, people: Map<string, TaskPerson>): TaskEventRecord => {
    const data = (row.data ?? {}) as EventData
    const subjectId = subjectIdOf(row)
    return {
        id: row.id,
        kind: row.kind as TaskEventKind,
        actor: row.actor ? toPerson(row.actor) : null,
        subject: subjectId ? (people.get(subjectId) ?? null) : null,
        from: text(data.from),
        to: text(data.to),
        createdAt: row.createdAt
    }
}
