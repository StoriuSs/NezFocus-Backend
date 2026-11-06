import { ConfigService } from '@nestjs/config'
import { CommandBus } from '@nestjs/cqrs'
import { Job, Queue } from 'bullmq'
import { CleanUpAuthCommand } from '@/modules/auth'
import { SweepDeletedAccountsCommand } from '@/modules/users'
import { MaintenanceConsumer } from './maintenance.consumer'

describe('MaintenanceConsumer', () => {
    const setup = (schedulersInRedis: string[] = []) => {
        const queue = {
            upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
            getJobSchedulers: jest.fn().mockResolvedValue(schedulersInRedis.map((key) => ({ key }))),
            removeJobScheduler: jest.fn().mockResolvedValue(true)
        }
        const commandBus = { execute: jest.fn().mockResolvedValue({}) }
        const config = {
            get: (key: string) => ({ 'app.deletedAccountRetentionDays': 30 })[key]
        }
        const consumer = new MaintenanceConsumer(
            commandBus as unknown as CommandBus,
            config as unknown as ConfigService,
            queue as unknown as Queue
        )
        return { consumer, queue, commandBus }
    }

    it('schedules every task, and removes a schedule no task has any more', async () => {
        const { consumer, queue } = setup(['deleted-accounts-sweep', 'auth-clean-up', 'retired-task'])

        await consumer.onApplicationBootstrap()

        expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'deleted-accounts-sweep',
            { every: 15 * 60_000 },
            { name: 'deleted-accounts-sweep' }
        )
        expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
            'auth-clean-up',
            { every: 60 * 60_000 },
            { name: 'auth-clean-up' }
        )
        expect(queue.removeJobScheduler.mock.calls).toEqual([['retired-task']])
    })

    it("sends each job's command to the module that owns it", async () => {
        const { consumer, commandBus } = setup()

        await consumer.process({ name: 'deleted-accounts-sweep', id: '1' } as Job)
        await consumer.process({ name: 'auth-clean-up', id: '2' } as Job)

        const [sweep, cleanUp] = commandBus.execute.mock.calls.map(([command]) => command)
        expect(sweep).toBeInstanceOf(SweepDeletedAccountsCommand)
        expect(sweep).toMatchObject({ retentionDays: 30 })
        expect(cleanUp).toBeInstanceOf(CleanUpAuthCommand)
    })

    it('ignores a job no task is named for', async () => {
        const { consumer, commandBus } = setup()

        await consumer.process({ name: 'sweep', id: '3' } as Job)

        expect(commandBus.execute).not.toHaveBeenCalled()
    })
})
