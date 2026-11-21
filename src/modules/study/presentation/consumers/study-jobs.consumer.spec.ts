import { CommandBus } from '@nestjs/cqrs'
import { Job } from 'bullmq'
import { CloseAwayCommand, EndEmptyRoomCommand, EndFocusPhaseCommand } from '../../application'
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

    it('closes a place away and ends an empty room through their commands, with the time each was set for', async () => {
        const { commandBus, consumer } = setUp()
        const since = '2026-11-21T20:10:00.000Z'
        await consumer.process({
            name: STUDY_JOBS.CLOSE_AWAY,
            id: 'away-p-1',
            data: { participationId: 'p', since }
        } as Job)
        await consumer.process({
            name: STUDY_JOBS.END_EMPTY,
            id: 'empty-phien-1',
            data: { sessionId: 'phien', since }
        } as Job)
        expect(commandBus.execute.mock.calls).toEqual([
            [new CloseAwayCommand('p', new Date(since))],
            [new EndEmptyRoomCommand('phien', new Date(since))]
        ])
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
