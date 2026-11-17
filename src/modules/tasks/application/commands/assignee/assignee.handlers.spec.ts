import { CannotChangeTaskError, InvalidTaskAssigneeError, TaskTimedOutError } from '../../../domain'
import { TaskUpdatedEvent } from '../../events/task-updated.event'
import { taskWorld } from '../../task-test-world.shared-spec'
import { AssignTaskCommand, UnassignTaskCommand } from './assignee.commands'
import { AssignTaskHandler, UnassignTaskHandler } from './assignee.handlers'

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
