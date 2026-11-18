import { NotifierPort } from '@/modules/notifications'
import { TaskView } from '../../services/task-views'
import { TaskCreatedEvent } from '../task-created.event'
import { TaskChange, TaskUpdatedEvent } from '../task-updated.event'
import { NotifyTaskPeopleHandler } from './notify-task-people.handler'

const DUE = new Date('2026-11-05T16:59:00Z')
const person = (id: string) => ({ id, username: id, displayName: id, avatarUrl: null })

const task = (assigneeIds: string[]): TaskView => ({
    id: 't1',
    serverId: 'nd',
    channelId: 'viec-nhom',
    title: 'Chuẩn bị demo cuối kỳ',
    description: '',
    status: 'todo',
    dueAt: DUE,
    completedAt: null,
    createdAt: DUE,
    updatedAt: DUE,
    creator: { ...person('an'), leftServer: false },
    assignees: assigneeIds.map((id) => ({ ...person(id), assignedAt: DUE, viewsChannel: true }))
})

const notice = { serverId: 'nd', channelId: 'viec-nhom', taskId: 't1', title: 'Chuẩn bị demo cuối kỳ', dueAt: DUE }

const change = (extra: Partial<TaskChange>): TaskChange => ({
    actorId: 'an',
    added: [],
    removed: [],
    before: { status: 'todo', dueAt: DUE },
    ...extra
})

function setup() {
    const notifier = {
        taskAssigned: jest.fn().mockResolvedValue(undefined),
        taskUnassigned: jest.fn().mockResolvedValue(undefined)
    }
    const handler = new NotifyTaskPeopleHandler(notifier as unknown as NotifierPort)
    return { notifier, handler }
}

describe('NotifyTaskPeopleHandler (D-98, D-95)', () => {
    it('gives the people a task is made with their items, from its creator', async () => {
        const { notifier, handler } = setup()
        await handler.handle(new TaskCreatedEvent(task(['binh', 'an'])))
        expect(notifier.taskAssigned).toHaveBeenCalledWith(notice, 'an', ['binh', 'an'])

        await handler.handle(new TaskCreatedEvent(task([])))
        expect(notifier.taskAssigned).toHaveBeenCalledTimes(1)
    })

    it('gives the people added later theirs, from whoever added them', async () => {
        const { notifier, handler } = setup()
        await handler.handle(new TaskUpdatedEvent(task(['binh', 'chi']), change({ actorId: 'binh', added: ['chi'] })))
        expect(notifier.taskAssigned).toHaveBeenCalledWith(notice, 'binh', ['chi'])
        expect(notifier.taskUnassigned).not.toHaveBeenCalled()
    })

    it('tells the creator when the last person on it takes themselves off', async () => {
        const { notifier, handler } = setup()
        await handler.handle(new TaskUpdatedEvent(task([]), change({ actorId: 'binh', removed: ['binh'] })))
        expect(notifier.taskUnassigned).toHaveBeenCalledWith(notice, 'an', 'binh', 'withdrew')
    })

    it('tells the creator when the last person on it left the server', async () => {
        const { notifier, handler } = setup()
        await handler.handle(new TaskUpdatedEvent(task([]), change({ actorId: null, removed: ['binh'] })))
        expect(notifier.taskUnassigned).toHaveBeenCalledWith(notice, 'an', 'binh', 'left_server')
    })

    it('tells no one when someone else takes the last person off, or someone still is on it', async () => {
        const { notifier, handler } = setup()
        await handler.handle(new TaskUpdatedEvent(task([]), change({ actorId: 'an', removed: ['binh'] })))
        await handler.handle(new TaskUpdatedEvent(task(['chi']), change({ actorId: 'binh', removed: ['binh'] })))
        await handler.handle(new TaskUpdatedEvent(task(['binh']), change({ before: { status: 'todo', dueAt: null } })))
        expect(notifier.taskUnassigned).not.toHaveBeenCalled()
        expect(notifier.taskAssigned).not.toHaveBeenCalled()
    })

    it('tells no one of a task already done left with no one on it: no one has to do it', async () => {
        const { notifier, handler } = setup()
        const done = { ...task([]), status: 'done' as const }
        await handler.handle(new TaskUpdatedEvent(done, change({ actorId: 'binh', removed: ['binh'] })))
        await handler.handle(new TaskUpdatedEvent(done, change({ actorId: null, removed: ['binh'] })))
        expect(notifier.taskUnassigned).not.toHaveBeenCalled()
    })

    it('logs a failure instead of failing: the task is saved', async () => {
        const { notifier, handler } = setup()
        notifier.taskAssigned.mockRejectedValueOnce(new Error('connection lost'))
        await expect(handler.handle(new TaskCreatedEvent(task(['binh'])))).resolves.toBeUndefined()
    })
})
