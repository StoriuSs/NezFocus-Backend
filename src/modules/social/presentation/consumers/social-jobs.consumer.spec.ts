import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { RingOutCallCommand } from '../../application'
import { SOCIAL_JOBS } from '../../infrastructure/adapters/social-jobs'
import { SocialJobsConsumer } from './social-jobs.consumer'

describe('SocialJobsConsumer (ARCHITECTURE 6)', () => {
    const setUp = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
        return { commandBus, consumer: new SocialJobsConsumer(commandBus as unknown as CommandBus) }
    }
    const job = { name: SOCIAL_JOBS.RING_OUT, id: 'call-goi-ring-0', data: { callId: 'goi', version: 0 } } as Job

    it('rings a call out through the command, with the version it was set for', async () => {
        const { commandBus, consumer } = setUp()
        await consumer.process(job)
        expect(commandBus.execute).toHaveBeenCalledWith(new RingOutCallCommand('goi', 0))
    })

    it('a failure fails the job, for the queue to try again', async () => {
        const { commandBus, consumer } = setUp()
        commandBus.execute.mockRejectedValueOnce(new Error('database down'))
        await expect(consumer.process(job)).rejects.toThrow('database down')
    })

    it('leaves a job it does not know', async () => {
        const { commandBus, consumer } = setUp()
        await consumer.process({ name: 'something-else', id: 'x', data: {} } as Job)
        expect(commandBus.execute).not.toHaveBeenCalled()
    })
})
