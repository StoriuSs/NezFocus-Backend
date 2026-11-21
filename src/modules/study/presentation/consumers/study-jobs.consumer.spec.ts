import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { EndFocusPhaseCommand } from '../../application'
import { STUDY_JOBS } from '../../infrastructure/adapters/study-jobs'
import { StudyJobsConsumer } from './study-jobs.consumer'

describe('StudyJobsConsumer (ARCHITECTURE 5.1)', () => {
    const setUp = () => {
        const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
        return { commandBus, consumer: new StudyJobsConsumer(commandBus as unknown as CommandBus) }
    }
    const job = { name: STUDY_JOBS.END_PHASE, id: 'focus-phien-3', data: { sessionId: 'phien', version: 3 } } as Job

    it('ends a phase through the command, with the version it was set for', async () => {
        const { commandBus, consumer } = setUp()
        await consumer.process(job)
        expect(commandBus.execute).toHaveBeenCalledWith(new EndFocusPhaseCommand('phien', 3))
    })

    it('a failure fails the job, for the queue to try again', async () => {
        const { commandBus, consumer } = setUp()
        commandBus.execute.mockRejectedValueOnce(new Error('connection lost'))
        await expect(consumer.process(job)).rejects.toThrow('connection lost')
    })

    it('ignores a job of a name it does not know', async () => {
        const { commandBus, consumer } = setUp()
        await consumer.process({ name: 'retired', id: '1', data: {} } as Job)
        expect(commandBus.execute).not.toHaveBeenCalled()
    })
})
