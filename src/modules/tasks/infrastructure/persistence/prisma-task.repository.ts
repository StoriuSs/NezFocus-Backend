import { Injectable } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'
import { PrismaService } from '@/shared/infrastructure/persistence/database/prisma.service'
import {
    MineFilter,
    NewTask,
    planLeftServer,
    TaskEventRecord,
    TaskFacts,
    TaskFilter,
    TaskRecord,
    TaskRepositoryPort,
    TaskStatus,
    TaskWrite
} from '../../domain'
import { eventRows } from './task-event-ids'
import { PERSON, subjectIdOf, TASK, TASK_EVENT, toEventRecord, toPerson, toTaskRecord } from './task.selections'

const prismaCode = (error: unknown) => (error as { code?: string })?.code

/** The client a Prisma transaction callback is given. */
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]

/**
 * The advisory lock that serialises adding a task not done to one channel,
 * by making one or reopening a done one, so its count of tasks not done
 * cannot change between reading it and adding one (500, REQ-TASK-01). Scoped
 * to the transaction. A task done or deleted meanwhile only lowers the
 * count, so those take no lock. Reopening takes it after the task's row
 * lock; making a task holds no task row, so the two never wait on each
 * other in turn.
 */
const openTasksLock = (channelId: string) => `channel-tasks:${channelId}`

/**
 * The words as LIKE takes them literally. Prisma's `contains` puts them
 * between `%` as they are, so a `%` or `_` typed would match anything: each
 * is escaped with LIKE's escape character, the backslash, itself escaped first.
 */
const likeLiteral = (words: string) => words.replace(/[\\%_]/g, (character) => `\\${character}`)

/** Which of a board's tasks: the channel's, with the folded words in their folded title (D-97). */
function matching({ channelId, search }: TaskFilter): Prisma.TaskWhereInput {
    return search ? { channelId, titleSearch: { contains: likeLiteral(search) } } : { channelId }
}

/**
 * Which tasks the To-do page lists (REQ-TASK-05): given to the reader, or
 * made by them and given no one, in the channels the application allows,
 * with the folded words in their folded title.
 */
function mine({ userId, channelIds, search }: MineFilter): Prisma.TaskWhereInput {
    return {
        channelId: { in: channelIds },
        OR: [{ assignees: { some: { userId } } }, { creatorId: userId, assignees: { none: {} } }],
        ...(search ? { titleSearch: { contains: likeLiteral(search) } } : {})
    }
}

/** Tasks not done: by due date, none last; ids are UUIDv7, so ties go by the order they were made in. */
const OPEN_ORDER: Prisma.TaskOrderByWithRelationInput[] = [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]

/** Task, TaskAssignee and TaskEvent: only the tasks module writes them (ARCHITECTURE 7). */
@Injectable()
export class PrismaTaskRepository implements TaskRepositoryPort {
    constructor(private readonly prisma: PrismaService) {}

    async create(
        { serverId, channelId, creatorId }: { serverId: string; channelId: string; creatorId: string },
        task: NewTask,
        decide: (openCount: number) => void
    ): Promise<TaskRecord | null> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${openTasksLock(channelId)}, 0))`
                decide(await tx.task.count({ where: { channelId, status: { not: 'done' } } }))

                const now = new Date()
                const { id } = await tx.task.create({
                    data: {
                        serverId,
                        channelId,
                        creatorId,
                        title: task.title,
                        titleSearch: task.titleSearch,
                        description: task.description,
                        dueAt: task.dueAt,
                        createdAt: now
                    },
                    select: { id: true }
                })
                if (task.assigneeIds.length > 0) {
                    await tx.taskAssignee.createMany({
                        data: task.assigneeIds.map((userId) => ({ taskId: id, userId, assignedAt: now }))
                    })
                }
                await tx.taskEvent.createMany({ data: eventRows(id, creatorId, task.events, now, null) })
                return toTaskRecord(await tx.task.findUniqueOrThrow({ where: { id }, select: TASK }))
            })
        } catch (error) {
            // The channel (or its server) went between the permission check and now.
            if (prismaCode(error) === 'P2003') return null
            throw error
        }
    }

    async change(
        taskId: string,
        actorId: string,
        decide: (task: TaskFacts) => TaskWrite | null
    ): Promise<{ record: TaskRecord; changed: boolean } | null> {
        return this.prisma.$transaction(async (tx) => {
            const facts = await this.lockFacts(tx, taskId)
            if (!facts) return null
            const write = decide(facts)
            if (write) {
                const now = new Date()
                // updatedAt moves on every write, a change of people included.
                await tx.task.update({ where: { id: taskId }, data: { ...write.changes, updatedAt: now } })
                if (write.removeAssigneeIds.length > 0) {
                    await tx.taskAssignee.deleteMany({ where: { taskId, userId: { in: write.removeAssigneeIds } } })
                }
                if (write.addAssigneeIds.length > 0) {
                    await tx.taskAssignee.createMany({
                        data: write.addAssigneeIds.map((userId) => ({ taskId, userId, assignedAt: now }))
                    })
                }
                const last = await tx.taskEvent.findFirst({
                    where: { taskId },
                    orderBy: { id: 'desc' },
                    select: { id: true }
                })
                await tx.taskEvent.createMany({
                    data: eventRows(taskId, actorId, write.events, now, last?.id ?? null)
                })
            }
            const record = toTaskRecord(await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: TASK }))
            return { record, changed: write !== null }
        })
    }

    async remove(taskId: string, decide: (task: TaskFacts) => void): Promise<boolean> {
        return this.prisma.$transaction(async (tx) => {
            const facts = await this.lockFacts(tx, taskId)
            if (!facts) return false
            decide(facts)
            // Its people, history and inbox items go with it (foreign keys, D-98).
            await tx.task.delete({ where: { id: taskId } })
            return true
        })
    }

    async unassignLeftMember(serverId: string, userId: string): Promise<TaskRecord[]> {
        const write = planLeftServer(userId)
        return this.prisma.$transaction(async (tx) => {
            // In id order, so two of these at once, or this and a change of one
            // task, never wait on each other in turn.
            const locked = await tx.$queryRaw<{ id: string }[]>`
                SELECT t."id" FROM "Task" t
                JOIN "TaskAssignee" a ON a."taskId" = t."id" AND a."userId" = ${userId}
                WHERE t."serverId" = ${serverId}
                ORDER BY t."id"
                FOR UPDATE OF t
            `
            const ids = locked.map((row) => row.id)
            if (ids.length === 0) return []
            const now = new Date()
            await tx.taskAssignee.deleteMany({
                where: { userId: { in: write.removeAssigneeIds }, taskId: { in: ids } }
            })
            await tx.task.updateMany({ where: { id: { in: ids } }, data: { updatedAt: now } })
            const lastLines = await tx.taskEvent.groupBy({
                by: ['taskId'],
                where: { taskId: { in: ids } },
                _max: { id: true }
            })
            const last = new Map(lastLines.map((line) => [line.taskId, line._max.id]))
            await tx.taskEvent.createMany({
                data: ids.flatMap((taskId) => eventRows(taskId, null, write.events, now, last.get(taskId) ?? null))
            })
            const rows = await tx.task.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: TASK })
            return rows.map(toTaskRecord)
        })
    }

    async find(taskId: string): Promise<TaskRecord | null> {
        const row = await this.prisma.task.findUnique({ where: { id: taskId }, select: TASK })
        return row ? toTaskRecord(row) : null
    }

    async listOpen(filter: TaskFilter): Promise<TaskRecord[]> {
        const rows = await this.prisma.task.findMany({
            where: { ...matching(filter), status: { not: 'done' } },
            orderBy: OPEN_ORDER,
            select: TASK
        })
        return rows.map(toTaskRecord)
    }

    async serversOfMine(userId: string): Promise<string[]> {
        // Two indexed reads, deduplicated by the database: the tasks given to
        // them (TaskAssignee by userId), and those they made for no one (Task
        // by creatorId); Prisma's `distinct` would read every row into memory.
        const rows = await this.prisma.$queryRaw<{ serverId: string }[]>`
            SELECT t."serverId" FROM "TaskAssignee" a JOIN "Task" t ON t."id" = a."taskId"
            WHERE a."userId" = ${userId}
            UNION
            SELECT t."serverId" FROM "Task" t
            WHERE t."creatorId" = ${userId}
              AND NOT EXISTS (SELECT 1 FROM "TaskAssignee" a WHERE a."taskId" = t."id")`
        return rows.map((row) => row.serverId)
    }

    async listMineOpen(filter: MineFilter): Promise<TaskRecord[]> {
        if (filter.channelIds.length === 0) return []
        const rows = await this.prisma.task.findMany({
            where: { ...mine(filter), status: { not: 'done' } },
            orderBy: OPEN_ORDER,
            select: TASK
        })
        return rows.map(toTaskRecord)
    }

    async countMineDone(filter: MineFilter): Promise<number> {
        if (filter.channelIds.length === 0) return 0
        return this.prisma.task.count({ where: { ...mine(filter), completedAt: { not: null } } })
    }

    async listMineDone(filter: MineFilter, beforeId: string | null, limit: number): Promise<TaskRecord[] | 'stale'> {
        if (filter.channelIds.length === 0) return beforeId ? 'stale' : []
        return this.donePage(mine(filter), beforeId, limit)
    }

    async countDone(filter: TaskFilter): Promise<number> {
        return this.prisma.task.count({ where: { ...matching(filter), completedAt: { not: null } } })
    }

    async listDone(filter: TaskFilter, beforeId: string | null, limit: number): Promise<TaskRecord[] | 'stale'> {
        return this.donePage(matching(filter), beforeId, limit)
    }

    /**
     * Done tasks of `which`, the latest done first, after the task `beforeId`
     * (itself one of them, or `stale`), one more than `limit`. completedAt,
     * not status: the index (channelId, completedAt, id) is read backwards
     * (M3 L1, EXPLAIN).
     */
    private async donePage(
        which: Prisma.TaskWhereInput,
        beforeId: string | null,
        limit: number
    ): Promise<TaskRecord[] | 'stale'> {
        let after: Prisma.TaskWhereInput = {}
        if (beforeId) {
            const cursor = await this.prisma.task.findFirst({
                where: { AND: [which, { id: beforeId, completedAt: { not: null } }] },
                select: { id: true, completedAt: true }
            })
            if (!cursor) return 'stale'
            after = {
                OR: [
                    { completedAt: { lt: cursor.completedAt! } },
                    { completedAt: cursor.completedAt!, id: { lt: cursor.id } }
                ]
            }
        }
        const rows = await this.prisma.task.findMany({
            // AND, not spread: `which` and `after` may each hold an OR.
            where: { AND: [which, { completedAt: { not: null } }, after] },
            orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            select: TASK
        })
        return rows.map(toTaskRecord)
    }

    async history(taskId: string, limit: number): Promise<{ items: TaskEventRecord[]; total: number }> {
        const [rows, total] = await Promise.all([
            this.prisma.taskEvent.findMany({
                where: { taskId },
                orderBy: { id: 'desc' },
                take: limit,
                select: TASK_EVENT
            }),
            this.prisma.taskEvent.count({ where: { taskId } })
        ])
        const ids = [...new Set(rows.map(subjectIdOf).filter((id): id is string => id !== null))]
        const people = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, ...PERSON }) : []
        const byId = new Map(people.map((person) => [person.id, toPerson(person)]))
        return { items: rows.map((row) => toEventRecord(row, byId)), total }
    }

    /**
     * The task as the rules need it, its row locked to the end of the
     * transaction: two changes at once take turns, each deciding on what the
     * other wrote. A done task also takes the channel's lock of the limit
     * and counts its tasks not done, for a reopening. Null when there is no
     * such task.
     */
    private async lockFacts(tx: Tx, taskId: string): Promise<TaskFacts | null> {
        const [row] = await tx.$queryRaw<
            {
                id: string
                channelId: string
                creatorId: string
                title: string
                description: string
                status: TaskStatus
                dueAt: Date | null
            }[]
        >`
            SELECT "id", "channelId", "creatorId", "title", "description", "status"::text AS "status", "dueAt"
            FROM "Task" WHERE "id" = ${taskId}
            FOR UPDATE
        `
        if (!row) return null
        const assignees = await tx.taskAssignee.findMany({
            where: { taskId },
            orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
            select: { userId: true }
        })
        let openCount: number | null = null
        if (row.status === 'done') {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${openTasksLock(row.channelId)}, 0))`
            openCount = await tx.task.count({ where: { channelId: row.channelId, status: { not: 'done' } } })
        }
        return { ...row, assigneeIds: assignees.map((assignee) => assignee.userId), openCount }
    }
}
