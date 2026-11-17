import { CannotChangeTaskError, InvalidTaskAssigneeError, TaskTimedOutError } from '../../../domain'
import { MembershipPort } from '@/modules/servers'
import { TaskUpdatedEvent } from '../../events/task-updated.event'
import { taskWorld } from '../../task-test-world.shared-spec'
import { AssignTaskCommand, UnassignLeftMemberCommand, UnassignTaskCommand } from './assignee.commands'
import { AssignTaskHandler, UnassignLeftMemberHandler, UnassignTaskHandler } from './assignee.handlers'

describe('AssignTaskHandler (REQ-TASK-02)', () => {
    function setup() {
        const world = taskWorld()
        const handler = new AssignTaskHandler(...world.ports, world.bus)
        const assign = (userId: string, taskId: string, ids: string[]) =>
            handler.execute(new AssignTaskCommand(userId, taskId, ids))
        return { ...world, assign }
    }

    it('lets anyone who views the channel take it on ("Tôi làm"), and tells the channel', async () => {
        const { assign, seed, events } = setup()
        const id = seed()

        const task = await assign('an', id, ['an'])

        expect(task.assignees.map((assignee) => assignee.id)).toEqual(['binh', 'an'])
        expect(events.publish).toHaveBeenCalledWith(new TaskUpdatedEvent(task))
    })

    it('lets an assignee add others, but not someone who only views the channel', async () => {
        const { assign, seed } = setup()
        const id = seed({ creatorId: 'an' })
        await expect(assign('binh', id, ['chi'])).resolves.toMatchObject({ assignees: [{ id: 'binh' }, { id: 'chi' }] })
        const other = seed({ creatorId: 'an', assignees: [] })
        await expect(assign('binh', other, ['chi'])).rejects.toBeInstanceOf(CannotChangeTaskError)
    })

    it('refuses someone who cannot view the channel, and someone timed out', async () => {
        const { assign, seed } = setup()
        const id = seed()
        await expect(assign('an', id, ['lan'])).rejects.toBeInstanceOf(InvalidTaskAssigneeError)
        await expect(assign('dung', id, ['dung'])).rejects.toBeInstanceOf(TaskTimedOutError)
    })

    it('changes nothing and tells no one when everyone is on it already', async () => {
        const { assign, seed, events } = setup()
        const id = seed()
        await assign('an', id, ['binh'])
        expect(events.publish).not.toHaveBeenCalled()
    })
})

describe('UnassignTaskHandler (REQ-TASK-02)', () => {
    function setup() {
        const world = taskWorld()
        const handler = new UnassignTaskHandler(...world.ports, world.bus)
        const unassign = (userId: string, taskId: string, assigneeId: string) =>
            handler.execute(new UnassignTaskCommand(userId, taskId, assigneeId))
        return { ...world, unassign }
    }

    it('lets the last assignee take themselves off: the task is "Chưa giao"', async () => {
        const { unassign, seed, history } = setup()
        const id = seed()

        const task = await unassign('binh', id, 'binh')

        expect(task.assignees).toEqual([])
        expect(history.get(id)).toEqual([
            { actorId: 'binh', event: { kind: 'assignee_removed', data: { userId: 'binh' } } }
        ])
    })

    it('lets only the creator or MANAGE_TASKS take off another', async () => {
        const { unassign, seed } = setup()
        const id = seed({
            assignees: [
                {
                    person: { id: 'binh', username: 'binh', displayName: 'BINH', avatarKey: null },
                    assignedAt: new Date()
                },
                { person: { id: 'chi', username: 'chi', displayName: 'CHI', avatarKey: null }, assignedAt: new Date() }
            ]
        })
        await expect(unassign('binh', id, 'chi')).rejects.toBeInstanceOf(CannotChangeTaskError)
        await expect(unassign('an', id, 'chi')).resolves.toMatchObject({ assignees: [{ id: 'binh' }] })
    })
})

describe('UnassignLeftMemberHandler (REQ-TASK-04, D-195)', () => {
    const on = (...ids: string[]) =>
        ids.map((id) => ({ person: { id, username: id, displayName: id, avatarKey: null }, assignedAt: new Date() }))

    function setup(members: string[] = ['an', 'binh', 'chi', 'dung', 'khanh']) {
        const world = taskWorld()
        // The servers module's table, read now: not the permission cache.
        const membership = {
            membersAmong: jest.fn(async (_serverId: string, ids: string[]) => ids.filter((id) => members.includes(id)))
        } as unknown as MembershipPort
        const handler = new UnassignLeftMemberHandler(
            world.repository,
            membership,
            world.checker,
            world.users,
            world.bus
        )
        return { ...world, handler }
    }

    it('takes someone who left off every task of the server, by no one, and tells each channel', async () => {
        const { handler, seed, tasks, history, events } = setup()
        const first = seed({ assignees: on('binh', 'lan') })
        const second = seed({ channelId: 'bi-mat', assignees: on('lan') })
        const elsewhere = seed({ serverId: 'other', assignees: on('lan') })
        seed({ assignees: on('binh') })

        await expect(handler.execute(new UnassignLeftMemberCommand('nd', 'lan'))).resolves.toBe(2)

        expect(tasks.get(first)!.assignees.map((assignee) => assignee.person.id)).toEqual(['binh'])
        expect(tasks.get(second)!.assignees).toEqual([])
        expect(tasks.get(elsewhere)!.assignees).toHaveLength(1)
        expect(history.get(second)).toEqual([
            { actorId: null, event: { kind: 'assignee_removed', data: { userId: 'lan' } } }
        ])
        const told = events.publish.mock.calls.map(([event]) => (event as TaskUpdatedEvent).task)
        expect(told.map((task) => task.id)).toEqual([first, second])
        expect(told[0]!.assignees).toEqual([expect.objectContaining({ id: 'binh', viewsChannel: true })])
    })

    it('takes them off even while the permission cache still holds them as a member', async () => {
        const { handler, seed, tasks } = setup(['an', 'chi', 'dung', 'khanh'])
        const id = seed({ assignees: on('binh') })

        // Bình left; the cache, not cleared, still answers for him.
        await expect(handler.execute(new UnassignLeftMemberCommand('nd', 'binh'))).resolves.toBe(1)

        expect(tasks.get(id)!.assignees).toEqual([])
    })

    it('leaves the tasks of someone who joined again before the job ran', async () => {
        const { handler, seed, repository, events } = setup()
        seed({ assignees: on('binh') })

        await expect(handler.execute(new UnassignLeftMemberCommand('nd', 'binh'))).resolves.toBe(0)

        expect(repository.unassignLeftMember).not.toHaveBeenCalled()
        expect(events.publish).not.toHaveBeenCalled()
    })
})
