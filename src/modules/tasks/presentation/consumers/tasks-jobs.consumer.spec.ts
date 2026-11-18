import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { SendTaskReminderCommand, UnassignLeftMemberCommand } from '../../application'
import { TASKS_JOBS } from '../../infrastructure/adapters/tasks-jobs'
import { TasksJobsConsumer } from './tasks-jobs.consumer'

describe('TasksJobsConsumer (D-195, REQ-TASK-04)', () => {
    const setUp = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(0) }
        return { commandBus, consumer: new TasksJobsConsumer(commandBus as unknown as CommandBus) }
    }
    const job = { name: TASKS_JOBS.UNASSIGN_LEFT_MEMBER, id: '1', data: { serverId: 'nd', userId: 'lan' } } as Job

    it('takes a member who left off its tasks through the command', async () => {
        const { commandBus, consumer } = setUp()

        await consumer.process(job)

        expect(commandBus.execute).toHaveBeenCalledWith(new UnassignLeftMemberCommand('nd', 'lan'))
    })

    it('sends a reminder through the command, with the due date it was set for', async () => {
        const { commandBus, consumer } = setUp()
        const dueAt = '2026-11-18T16:59:00.000Z'

        await consumer.process({
            name: TASKS_JOBS.SEND_REMINDER,
            id: '2',
            data: { taskId: 't1', mark: '2h', dueAt }
        } as Job)

        expect(commandBus.execute).toHaveBeenCalledWith(new SendTaskReminderCommand('t1', '2h', new Date(dueAt)))
    })

    it('a failure fails the job, for the queue to try again', async () => {
        const { commandBus, consumer } = setUp()
        commandBus.execute.mockRejectedValueOnce(new Error('connection lost'))

        await expect(consumer.process(job)).rejects.toThrow('connection lost')
    })

    it('ignores a job of a name it does not know', async () => {
        const { commandBus, consumer } = setUp()

        await consumer.process({ name: 'retired', id: '3', data: {} } as Job)

        expect(commandBus.execute).not.toHaveBeenCalled()
    })
})
