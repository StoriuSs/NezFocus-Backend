import {
    CannotChangeTaskError,
    ChannelNotFoundError,
    InvalidTaskAssigneeError,
    MAX_OPEN_TASKS,
    MaxOpenTasksReachedError,
    TaskBoardDisabledError,
    TaskNotFoundError,
    TaskTimedOutError
} from '../../../domain'
import { TaskCreatedEvent } from '../../events/task-created.event'
import { TaskDeletedEvent } from '../../events/task-deleted.event'
import { TaskUpdatedEvent } from '../../events/task-updated.event'
import { IN_A_DAY, taskWorld } from '../../task-test-world.shared-spec'
import { CreateTaskCommand, DeleteTaskCommand, UpdateTaskCommand } from './task.commands'
import { CreateTaskHandler, DeleteTaskHandler, UpdateTaskHandler } from './task.handlers'

const draft = (extra: Partial<CreateTaskCommand['draft']> = {}) => ({
    title: 'Nộp báo cáo giữa kỳ',
    description: '',
    dueAt: IN_A_DAY,
    assigneeIds: ['binh'],
    ...extra
})

describe('CreateTaskHandler (REQ-TASK-01, 02)', () => {
    function setup() {
        const world = taskWorld()
        const handler = new CreateTaskHandler(...world.ports, world.bus)
        const create = (userId: string, channelId: string, extra: Partial<CreateTaskCommand['draft']> = {}) =>
            handler.execute(new CreateTaskCommand(userId, channelId, draft(extra)))
        return { ...world, create }
    }

    it('makes the task, tells the channel, and answers with what it told (D-191)', async () => {
        const { create, events, history } = setup()

        const task = await create('binh', 'viec-nhom')

        expect(task).toMatchObject({
            channelId: 'viec-nhom',
            serverId: 'nd',
            title: 'Nộp báo cáo giữa kỳ',
            creator: { id: 'binh', avatarUrl: null },
            assignees: [{ id: 'binh' }]
        })
        expect(events.publish).toHaveBeenCalledWith(new TaskCreatedEvent(task))
        expect(history.get(task.id)!.map(({ event }) => event.kind)).toEqual([
            'created',
            'due_changed',
            'assignee_added'
        ])
    })

    it('answers not found for a channel one cannot view, a voice room or no channel at all (NFR-SEC-05)', async () => {
        const { create } = setup()
        await expect(create('binh', 'bi-mat')).rejects.toBeInstanceOf(ChannelNotFoundError)
        await expect(create('chi', 'phong')).rejects.toBeInstanceOf(ChannelNotFoundError)
        await expect(create('lan', 'viec-nhom')).rejects.toBeInstanceOf(ChannelNotFoundError)
        await expect(create('binh', 'nope')).rejects.toBeInstanceOf(ChannelNotFoundError)
    })

    it('refuses on a board that is off, saying so (task_board_disabled)', async () => {
        const { create, events } = setup()
        const refused = create('an', 'hoi-dap')
        await expect(refused).rejects.toBeInstanceOf(TaskBoardDisabledError)
        await expect(refused).rejects.toMatchObject({ details: { reason: 'task_board_disabled' } })
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('refuses someone timed out, with the end of the timeout (D-188)', async () => {
        const { create } = setup()
        await expect(create('dung', 'viec-nhom')).rejects.toBeInstanceOf(TaskTimedOutError)
    })

    it('refuses to give it to someone who cannot view the channel, naming them', async () => {
        const { create, repository } = setup()
        await expect(create('chi', 'bi-mat', { assigneeIds: ['chi', 'binh', 'lan'] })).rejects.toMatchObject({
            constructor: InvalidTaskAssigneeError,
            details: { userIds: ['binh', 'lan'] }
        })
        expect(repository.create).not.toHaveBeenCalled()
    })

    it('stops at 500 tasks not done in the channel; done ones do not count', async () => {
        const { create, seed } = setup()
        for (let i = 0; i < MAX_OPEN_TASKS - 1; i++) seed()
        seed({ status: 'done', completedAt: new Date() })

        await create('binh', 'viec-nhom')
        await expect(create('binh', 'viec-nhom')).rejects.toBeInstanceOf(MaxOpenTasksReachedError)
    })
})

describe('UpdateTaskHandler (REQ-TASK-01 to 03, D-96)', () => {
    function setup() {
        const world = taskWorld()
        const handler = new UpdateTaskHandler(...world.ports, world.bus)
        const update = (userId: string, taskId: string, edit: UpdateTaskCommand['edit']) =>
            handler.execute(new UpdateTaskCommand(userId, taskId, edit))
        return { ...world, update }
    }

    it('lets an assignee mark it done, stamps the time and tells the channel', async () => {
        const { update, seed, events } = setup()
        const id = seed()

        const task = await update('binh', id, { status: 'done' })

        expect(task.status).toBe('done')
        expect(task.completedAt).toBeInstanceOf(Date)
        expect(events.publish).toHaveBeenCalledWith(
            new TaskUpdatedEvent(task, {
                actorId: 'binh',
                added: [],
                removed: [],
                before: { status: 'todo', dueAt: IN_A_DAY }
            })
        )
    })

    it('tells no one when nothing changes', async () => {
        const { update, seed, events } = setup()
        const id = seed()
        await update('an', id, { title: 'Sửa lỗi đăng nhập', dueAt: IN_A_DAY })
        expect(events.publish).not.toHaveBeenCalled()
    })

    it('refuses an assignee who edits the title, and anyone who only views the channel', async () => {
        const { update, seed } = setup()
        const id = seed()
        await expect(update('binh', id, { title: 'Khác' })).rejects.toBeInstanceOf(CannotChangeTaskError)
        await expect(update('dung', id, { status: 'done' })).rejects.toBeInstanceOf(TaskTimedOutError)
        await expect(update('chi', id, { title: 'Khác' })).resolves.toMatchObject({ title: 'Khác' })
    })

    it('lets an ADMINISTRATOR change a task through a timeout, as the owner (appendix B, step 1)', async () => {
        const { update, seed } = setup()
        const id = seed()
        await expect(update('khanh', id, { status: 'done' })).resolves.toMatchObject({ status: 'done' })
    })

    it('answers not found for a task in a channel one cannot view, as for no task (NFR-SEC-05)', async () => {
        const { update, seed } = setup()
        const hidden = seed({ channelId: 'bi-mat' })
        await expect(update('binh', hidden, { status: 'done' })).rejects.toBeInstanceOf(TaskNotFoundError)
        await expect(update('binh', 'nope', { status: 'done' })).rejects.toBeInstanceOf(TaskNotFoundError)
    })

    it('refuses on a board that is off', async () => {
        const { update, seed } = setup()
        const id = seed({ channelId: 'hoi-dap' })
        await expect(update('an', id, { status: 'done' })).rejects.toBeInstanceOf(TaskBoardDisabledError)
    })

    it('answers not found when the task was deleted between opening it and the write', async () => {
        const { update, seed, repository } = setup()
        const id = seed()
        ;(repository.change as jest.Mock).mockResolvedValueOnce(null)
        await expect(update('an', id, { status: 'done' })).rejects.toBeInstanceOf(TaskNotFoundError)
    })
})

describe('DeleteTaskHandler (REQ-TASK-02)', () => {
    function setup() {
        const world = taskWorld()
        const handler = new DeleteTaskHandler(...world.ports, world.bus)
        const remove = (userId: string, taskId: string) => handler.execute(new DeleteTaskCommand(userId, taskId))
        return { ...world, remove }
    }

    it('lets the creator or MANAGE_TASKS delete it, and tells the channel and those who may have had items of it (D-200)', async () => {
        const { remove, seed, tasks, events, history } = setup()
        const mine = seed({ creatorId: 'binh', assignees: [] })
        const other = seed()
        // Bình on it since it was made, Chi added once and taken off since: both may have an item.
        history
            .get(other)!
            .push(
                { actorId: 'an', event: { kind: 'assignee_added', data: { userId: 'binh' } } },
                { actorId: 'an', event: { kind: 'assignee_added', data: { userId: 'chi' } } },
                { actorId: 'an', event: { kind: 'assignee_removed', data: { userId: 'chi' } } }
            )

        await remove('binh', mine)
        await remove('chi', other)

        expect(tasks.size).toBe(0)
        expect(events.publish).toHaveBeenCalledWith(
            new TaskDeletedEvent(mine, 'viec-nhom', { status: 'todo', dueAt: IN_A_DAY }, ['binh'])
        )
        expect(events.publish).toHaveBeenCalledWith(
            new TaskDeletedEvent(other, 'viec-nhom', { status: 'todo', dueAt: IN_A_DAY }, ['an', 'binh', 'chi'])
        )
    })

    it('refuses an assignee who did not make it', async () => {
        const { remove, seed, tasks } = setup()
        const id = seed()
        await expect(remove('binh', id)).rejects.toBeInstanceOf(CannotChangeTaskError)
        expect(tasks.has(id)).toBe(true)
    })
})
