import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { UnassignLeftMemberCommand } from '../../application'
import { TASKS_JOBS } from '../../infrastructure/adapters/tasks-jobs'
import { TasksJobsConsumer } from './tasks-jobs.consumer'

describe('TasksJobsConsumer (D-195)', () => {
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
