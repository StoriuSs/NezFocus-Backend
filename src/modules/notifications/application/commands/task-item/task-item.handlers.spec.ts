import { TaskItemDraft } from '../../../domain'
import { NotificationsCreatedEvent } from '../../events/notifications-created.event'
import { NotificationsDeletedEvent } from '../../events/notifications-deleted.event'
import { notificationWorld } from '../../notification-test-world.shared-spec'
import { AddTaskItemsCommand, ForgetTaskItemsCommand } from './task-item.commands'
import { AddTaskItemsHandler, ForgetTaskItemsHandler } from './task-item.handlers'

const DUE = new Date('2026-11-05T16:59:00Z')
const place = { serverId: 'ot', channelId: 'hoi-dap', taskId: 't1' }
const facts = { title: 'Chuẩn bị demo cuối kỳ', dueAt: DUE, reminder: null, unassignedBy: null }

const assigned: TaskItemDraft = { type: 'task_assigned', place, actorId: 'an', facts }
const reminder = (mark: '24h' | '2h', dueAt = DUE): TaskItemDraft => ({
    type: 'task_reminder',
    place,
    actorId: null,
    facts: { ...facts, dueAt, reminder: mark }
})

describe('AddTaskItemsHandler (D-95, D-98, REQ-TASK-04)', () => {
    it('gives each person put on a task one unread item that keeps its title and due date, never the one who did it', async () => {
        const world = notificationWorld()
        await new AddTaskItemsHandler(...world.deps).execute(
            new AddTaskItemsCommand(assigned, ['binh', 'an', 'chi', 'binh'])
        )

        expect(world.rows.map((row) => [row.userId, row.type, row.taskId, row.readAt])).toEqual([
            ['binh', 'task_assigned', 't1', null],
            ['chi', 'task_assigned', 't1', null]
        ])
        const [created] = world.published(NotificationsCreatedEvent) as NotificationsCreatedEvent[]
        expect(created!.items.map((item) => item.userId).sort()).toEqual(['binh', 'chi'])
        expect(created!.items[0]!.notification).toMatchObject({
            type: 'task_assigned',
            channelId: 'hoi-dap',
            taskId: 't1',
            messageId: null,
            message: null,
            actor: { id: 'an', avatarUrl: 'https://cdn/an.png' },
            task: { title: 'Chuẩn bị demo cuối kỳ', dueAt: DUE, reminder: null, unassignedBy: null }
        })
    })

    it('writes nothing and tells no one when only the one who acted is named: taking a task on oneself', async () => {
        const world = notificationWorld()
        await new AddTaskItemsHandler(...world.deps).execute(new AddTaskItemsCommand(assigned, ['an']))
        expect(world.rows).toEqual([])
        expect(world.repository.addTaskItems).not.toHaveBeenCalled()
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })

    it('tells the creator of a task left with no one on it, unless they are the one who left', async () => {
        const world = notificationWorld()
        const handler = new AddTaskItemsHandler(...world.deps)
        const left = (actorId: string): TaskItemDraft => ({
            type: 'task_unassigned',
            place,
            actorId,
            facts: { ...facts, unassignedBy: 'withdrew' }
        })

        await handler.execute(new AddTaskItemsCommand(left('an'), ['an']))
        expect(world.rows).toEqual([])

        await handler.execute(new AddTaskItemsCommand(left('binh'), ['an']))
        expect(world.rows.map((row) => [row.userId, row.type, row.actor?.id, row.task?.unassignedBy])).toEqual([
            ['an', 'task_unassigned', 'binh', 'withdrew']
        ])
    })

    it('writes a reminder once per mark and due date: a job run again adds none twice', async () => {
        const world = notificationWorld()
        const handler = new AddTaskItemsHandler(...world.deps)

        await handler.execute(new AddTaskItemsCommand(reminder('24h'), ['binh']))
        await handler.execute(new AddTaskItemsCommand(reminder('24h'), ['binh', 'chi']))
        expect(world.rows.map((row) => row.userId)).toEqual(['binh', 'chi'])

        // The next mark, or the same mark of a due date moved, is a new reminder.
        await handler.execute(new AddTaskItemsCommand(reminder('2h'), ['binh']))
        await handler.execute(new AddTaskItemsCommand(reminder('24h', new Date('2026-11-06T16:59:00Z')), ['binh']))
        expect(world.rows.map((row) => [row.userId, row.task?.reminder])).toEqual([
            ['binh', '24h'],
            ['chi', '24h'],
            ['binh', '2h'],
            ['binh', '24h']
        ])
        expect(world.rows.every((row) => row.actor === null)).toBe(true)
    })

    it('tells no one of a task deleted while its items were written', async () => {
        const world = notificationWorld()
        world.deletedTasks.add('t1')
        await new AddTaskItemsHandler(...world.deps).execute(new AddTaskItemsCommand(assigned, ['binh']))
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})

describe('ForgetTaskItemsHandler (D-98, D-200)', () => {
    it('tells everyone who may have had an item of the deleted task, with the task and their unread count now', async () => {
        const world = notificationWorld()
        world.seed({ userId: 'binh', messageId: 'm1' })
        await new ForgetTaskItemsHandler(...world.deps).execute(new ForgetTaskItemsCommand('t1', ['an', 'binh', 'an']))

        const [deleted] = world.published(NotificationsDeletedEvent) as NotificationsDeletedEvent[]
        expect(deleted!.entries).toEqual([
            { userId: 'an', ids: [], unreadCount: 0, taskId: 't1' },
            { userId: 'binh', ids: [], unreadCount: 1, taskId: 't1' }
        ])
    })

    it('tells no one when no one was named', async () => {
        const world = notificationWorld()
        await new ForgetTaskItemsHandler(...world.deps).execute(new ForgetTaskItemsCommand('t1', []))
        expect(world.eventBus.publish).not.toHaveBeenCalled()
    })
})

describe('AddTaskItemsHandler and blocks (D-185, D-242)', () => {
    it('makes no task item for someone who blocked the one who acted', async () => {
        const world = notificationWorld()
        world.block('chi', 'an')

        await new AddTaskItemsHandler(...world.deps).execute(
            new AddTaskItemsCommand(
                {
                    type: 'task_assigned',
                    place: { serverId: 'ot', channelId: 'hoi-dap', taskId: 't1' },
                    actorId: 'an',
                    facts: { title: 'Ôn chương 3', dueAt: null, reminder: null, unassignedBy: null }
                },
                ['binh', 'chi']
            )
        )

        expect(world.rows.map((row) => row.userId)).toEqual(['binh'])
    })
})
