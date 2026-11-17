import { StaleTaskCursorError } from '../../../domain'
import { taskWorld } from '../../task-test-world.shared-spec'
import { ListMyDoneTasksQuery, ListMyTasksQuery } from './mine.queries'
import { ListMyDoneTasksHandler, ListMyTasksHandler } from './mine.handlers'

const HOUR = 3600_000
const on = (userId: string) => ({
    person: { id: userId, username: userId, displayName: null, avatarKey: null },
    assignedAt: new Date()
})

describe('ListMyTasksHandler (REQ-TASK-05, S-TASK-04, D-186)', () => {
    it('lists the tasks given to one and those one made for no one, from boards one views that are on', async () => {
        const world = taskWorld()
        const given = world.seed({ creatorId: 'an', assignees: [on('binh'), on('chi')] })
        const madeForNoOne = world.seed({ creatorId: 'binh', assignees: [] })
        world.seed({ creatorId: 'binh', assignees: [on('chi')] }) // made by Bình, given to Chi: Chi's
        world.seed({ channelId: 'hoi-dap', assignees: [on('binh')] }) // board off
        world.seed({ channelId: 'bi-mat', assignees: [on('binh'), on('chi')] }) // private to Quản lý việc: Chi's only
        world.seed({ serverId: 'cu', channelId: 'viec-cu', assignees: [on('binh')] }) // a server Bình left
        world.seed({ status: 'done', completedAt: new Date(), assignees: [on('binh')] })
        const handler = new ListMyTasksHandler(...world.ports)

        const list = await handler.execute(new ListMyTasksQuery('binh', null, null))

        expect(list.items.map((task) => task.id)).toEqual([given, madeForNoOne])
        expect(list).toMatchObject({ doneCount: 1, hasMore: false })
        // Chi views #bi-mat: the same server, one more channel.
        const chi = await handler.execute(new ListMyTasksQuery('chi', null, null))
        expect(chi.items).toHaveLength(3)
    })

    it('puts each task in its group in the time zone of one’s settings, and counts overdue and today for the badge', async () => {
        const world = taskWorld()
        const now = Date.now()
        const at = (ms: number | null) =>
            world.seed({ dueAt: ms === null ? null : new Date(ms), assignees: [on('binh')] })
        at(now - HOUR)
        at(null)
        at(now + 30 * 24 * HOUR)
        at(now + 3 * 24 * HOUR)
        ;(world.users.timeZoneOf as jest.Mock).mockResolvedValue(null)
        const handler = new ListMyTasksHandler(...world.ports)

        const list = await handler.execute(new ListMyTasksQuery('binh', null, null))

        expect(list.items.map((task) => task.group)).toEqual(['overdue', 'next_7_days', 'later', 'no_due'])
        expect(list.dueCount).toBe(1)
        expect(world.users.timeZoneOf).toHaveBeenCalledWith('binh')
    })

    it('keeps one server’s tasks, and searches folded words (D-97)', async () => {
        const world = taskWorld()
        world.seed({ assignees: [on('binh')] })
        const handler = new ListMyTasksHandler(...world.ports)

        await expect(handler.execute(new ListMyTasksQuery('binh', 'khac', null))).resolves.toMatchObject({
            items: [],
            doneCount: 0,
            dueCount: 0
        })
        await handler.execute(new ListMyTasksQuery('binh', 'nd', '  ĐĂNG Nhập '))
        expect(world.repository.listMineOpen).toHaveBeenLastCalledWith({
            userId: 'binh',
            channelIds: ['viec-nhom'],
            search: 'dang nhap'
        })
    })
})

describe('ListMyDoneTasksHandler (D-97)', () => {
    it('gives one’s done tasks a page at a time, without a group', async () => {
        const world = taskWorld()
        const done = world.seed({ status: 'done', completedAt: new Date(), assignees: [on('binh')] })
        world.seed({ status: 'done', completedAt: new Date(), channelId: 'hoi-dap', assignees: [on('binh')] })
        const handler = new ListMyDoneTasksHandler(...world.ports)

        const list = await handler.execute(new ListMyDoneTasksQuery('binh', null, null, null))

        expect(list.items.map((task) => [task.id, task.group])).toEqual([[done, null]])
        expect(list).toMatchObject({ doneCount: null, dueCount: null, hasMore: false })
    })

    it('says 50 a page and whether there are more', async () => {
        const world = taskWorld()
        const page = Array.from({ length: 51 }, () => world.tasks.get(world.seed({ status: 'done' }))!)
        ;(world.repository.listMineDone as jest.Mock).mockResolvedValue(page)
        const list = await new ListMyDoneTasksHandler(...world.ports).execute(
            new ListMyDoneTasksQuery('binh', null, null, null)
        )
        expect(list.items).toHaveLength(50)
        expect(list.hasMore).toBe(true)
    })

    it('asks the client to start again when the task it pages after is no longer one of its done tasks', async () => {
        const world = taskWorld()
        const reopened = world.seed({ assignees: [on('binh')] })
        await expect(
            new ListMyDoneTasksHandler(...world.ports).execute(new ListMyDoneTasksQuery('binh', null, null, reopened))
        ).rejects.toBeInstanceOf(StaleTaskCursorError)
    })
})
