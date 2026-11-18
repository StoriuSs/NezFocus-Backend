import { NotifierPort } from '@/modules/notifications'
import { TaskDeletedEvent } from '../task-deleted.event'
import { NotifyDeletedTaskHandler } from './notify-deleted-task.handler'

describe('NotifyDeletedTaskHandler (D-98, D-200)', () => {
    const event = new TaskDeletedEvent('t1', 'viec-nhom', { status: 'todo', dueAt: null }, ['an', 'binh'])

    it('tells everyone who may have had an item of the task that its items went', async () => {
        const notifier = { taskDeleted: jest.fn().mockResolvedValue(undefined) }
        await new NotifyDeletedTaskHandler(notifier as unknown as NotifierPort).handle(event)
        expect(notifier.taskDeleted).toHaveBeenCalledWith('t1', ['an', 'binh'])
    })

    it('logs a failure instead of failing: the task is deleted', async () => {
        const notifier = { taskDeleted: jest.fn().mockRejectedValue(new Error('connection lost')) }
        await expect(
            new NotifyDeletedTaskHandler(notifier as unknown as NotifierPort).handle(event)
        ).resolves.toBeUndefined()
    })
})
