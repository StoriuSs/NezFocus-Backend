import { StaleTaskCursorError, TaskBoardDisabledError, TaskNotFoundError } from '../../../domain'
import { taskWorld } from '../../task-test-world.shared-spec'
import { GetTaskQuery, ListBoardTasksQuery, ListDoneTasksQuery, ListTaskHistoryQuery } from './task.queries'
import { GetTaskHandler, ListBoardTasksHandler, ListDoneTasksHandler, ListTaskHistoryHandler } from './task.handlers'

describe('ListBoardTasksHandler (S-TASK-01, D-186)', () => {
    it('gives the tasks not done and how many are done, searching folded words (D-97)', async () => {
        const world = taskWorld()
        world.seed()
        world.seed({ status: 'done', completedAt: new Date() })
        const handler = new ListBoardTasksHandler(...world.ports)

        const list = await handler.execute(new ListBoardTasksQuery('binh', 'viec-nhom', '  ĐĂNG Nhập '))

        expect(list).toMatchObject({ doneCount: 1, hasMore: false })
        expect(list.items).toHaveLength(1)
        expect(world.repository.listOpen).toHaveBeenCalledWith({ channelId: 'viec-nhom', search: 'dang nhap' })
        await handler.execute(new ListBoardTasksQuery('binh', 'viec-nhom', '   '))
        expect(world.repository.listOpen).toHaveBeenLastCalledWith({ channelId: 'viec-nhom', search: null })
    })

    it('says the board is off, to those who view the channel', async () => {
        const world = taskWorld()
        const handler = new ListBoardTasksHandler(...world.ports)
        await expect(handler.execute(new ListBoardTasksQuery('binh', 'hoi-dap', null))).rejects.toBeInstanceOf(
            TaskBoardDisabledError
        )
    })
})

describe('ListDoneTasksHandler (D-97)', () => {
    it('gives 50 a page and says whether there are more', async () => {
        const world = taskWorld()
        const page = Array.from({ length: 51 }, () => world.tasks.get(world.seed({ status: 'done' }))!).map(
            (task, i) => ({ ...task, id: `done-${i}` })
        )
        ;(world.repository.listDone as jest.Mock).mockResolvedValue(page)
        const handler = new ListDoneTasksHandler(...world.ports)

        const list = await handler.execute(new ListDoneTasksQuery('binh', 'viec-nhom', null, null))

        expect(list.items).toHaveLength(50)
        expect(list).toMatchObject({ doneCount: null, hasMore: true })
    })

    it('asks the client to start again when the task it pages after is no longer done', async () => {
        const world = taskWorld()
        ;(world.repository.listDone as jest.Mock).mockResolvedValue('stale')
        const handler = new ListDoneTasksHandler(...world.ports)
        await expect(
            handler.execute(new ListDoneTasksQuery('binh', 'viec-nhom', null, 'task-9'))
        ).rejects.toBeInstanceOf(StaleTaskCursorError)
    })
})

describe('GetTaskHandler, ListTaskHistoryHandler (S-TASK-02)', () => {
    it('give a task and its history to those who view its channel, not found to the rest', async () => {
        const world = taskWorld()
        const id = world.seed({ channelId: 'bi-mat' })
        ;(world.repository.history as jest.Mock).mockResolvedValue({ items: [], total: 0 })
        const get = new GetTaskHandler(...world.ports)
        const history = new ListTaskHistoryHandler(...world.ports)

        await expect(get.execute(new GetTaskQuery('chi', id))).resolves.toMatchObject({ id, channelId: 'bi-mat' })
        await expect(history.execute(new ListTaskHistoryQuery('chi', id))).resolves.toEqual({ items: [], total: 0 })
        await expect(get.execute(new GetTaskQuery('binh', id))).rejects.toBeInstanceOf(TaskNotFoundError)
        await expect(history.execute(new ListTaskHistoryQuery('binh', id))).rejects.toBeInstanceOf(TaskNotFoundError)
    })
})
