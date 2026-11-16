import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { DeleteRecentMessagesCommand } from '../../application'
import { MESSAGING_JOBS } from '../../infrastructure/adapters/messaging-jobs'
import { MessagingJobsConsumer } from './messaging-jobs.consumer'

describe('MessagingJobsConsumer (D-181)', () => {
    const setUp = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
        return { commandBus, consumer: new MessagingJobsConsumer(commandBus as unknown as CommandBus) }
    }

    it("deletes a ban's messages through the command, its window back to dates", async () => {
        const { commandBus, consumer } = setUp()

        await consumer.process({
            name: MESSAGING_JOBS.DELETE_RECENT,
            id: '1',
            data: { serverId: 'ot', userId: 'khanh', from: '2026-11-09T09:00:00.000Z', to: '2026-11-16T09:00:00.000Z' }
        } as Job)

        expect(commandBus.execute).toHaveBeenCalledWith(
            new DeleteRecentMessagesCommand(
                'ot',
                'khanh',
                new Date('2026-11-09T09:00:00Z'),
                new Date('2026-11-16T09:00:00Z')
            )
        )
    })

    it('a failure fails the job, for the queue to try again', async () => {
        const { commandBus, consumer } = setUp()
        commandBus.execute.mockRejectedValueOnce(new Error('connection lost'))

        await expect(
            consumer.process({
                name: MESSAGING_JOBS.DELETE_RECENT,
                id: '2',
                data: {
                    serverId: 'ot',
                    userId: 'khanh',
                    from: '2026-11-09T09:00:00.000Z',
                    to: '2026-11-16T09:00:00.000Z'
                }
            } as Job)
        ).rejects.toThrow('connection lost')
    })

    it('ignores a job of a name it does not know', async () => {
        const { commandBus, consumer } = setUp()

        await consumer.process({ name: 'retired', id: '3', data: {} } as Job)

        expect(commandBus.execute).not.toHaveBeenCalled()
    })
})
