import { CommandBus } from '@nestjs/cqrs'
import { PostTaskDueCommand } from '@/modules/messaging'
import { NotifierPort } from '@/modules/notifications'
import { IN_A_DAY, NOW, taskWorld } from '../../task-test-world.shared-spec'
import { SendTaskReminderCommand } from './reminder.commands'
import { SendTaskReminderHandler } from './reminder.handlers'

const person = (id: string) => ({ person: { id, username: id, displayName: id, avatarKey: null }, assignedAt: NOW })

function setup() {
    const world = taskWorld()
    const notifier = { taskReminder: jest.fn().mockResolvedValue(undefined) }
    const commandBus = { execute: jest.fn().mockResolvedValue(undefined) }
    const handler = new SendTaskReminderHandler(
        world.repository,
        world.checker,
        notifier as unknown as NotifierPort,
        commandBus as unknown as CommandBus
    )
    const send = (taskId: string, mark: '24h' | '2h' = '24h', dueAt = IN_A_DAY) =>
        handler.execute(new SendTaskReminderCommand(taskId, mark, dueAt))
    return { ...world, notifier, commandBus, send }
}

describe('SendTaskReminderHandler (REQ-TASK-04, MSG-08)', () => {
    it('reminds the people on it in their inbox, then says it in the channel naming them', async () => {
        const { send, seed, notifier, commandBus } = setup()
        const id = seed({ title: 'Nộp báo cáo giữa kỳ', assignees: [person('binh'), person('chi')] })

        await expect(send(id, '2h')).resolves.toBe(true)

        expect(notifier.taskReminder).toHaveBeenCalledWith(
            { serverId: 'nd', channelId: 'viec-nhom', taskId: id, title: 'Nộp báo cáo giữa kỳ', dueAt: IN_A_DAY },
            '2h',
            ['binh', 'chi']
        )
        expect(commandBus.execute).toHaveBeenCalledWith(
            new PostTaskDueCommand('nd', 'viec-nhom', {
                taskId: id,
                title: 'Nộp báo cáo giữa kỳ',
                reminder: '2h',
                dueAt: IN_A_DAY.toISOString(),
                userIds: ['binh', 'chi']
            })
        )
        // The inbox first: a job run again after the message adds no item twice.
        expect(notifier.taskReminder.mock.invocationCallOrder[0]).toBeLessThan(
            commandBus.execute.mock.invocationCallOrder[0]!
        )
    })

    it('leaves out someone on it who lost the channel, and reminds its creator when no one on it views it', async () => {
        const { send, seed, notifier, commandBus } = setup()
        // Lan left the server; Bình cannot view #bi-mat.
        const some = seed({ channelId: 'bi-mat', assignees: [person('chi'), person('binh')] })
        const none = seed({ channelId: 'bi-mat', creatorId: 'chi', assignees: [person('binh'), person('lan')] })
        const nobody = seed({ creatorId: 'chi', assignees: [] })

        await send(some)
        await send(none)
        await send(nobody)

        expect(notifier.taskReminder.mock.calls.map((call) => call[2])).toEqual([['chi'], ['chi'], ['chi']])
        expect(commandBus.execute.mock.calls.map(([command]) => (command as PostTaskDueCommand).due.userIds)).toEqual([
            ['chi'],
            ['chi'],
            ['chi']
        ])
    })

    it('names the creator in the channel without an item when even they cannot view it', async () => {
        const { send, seed, notifier, commandBus } = setup()
        // In #bi-mat, which only Quản lý việc (Chi) and the owner view: Dũng on it and Bình who made it do not.
        const id = seed({ channelId: 'bi-mat', creatorId: 'binh', assignees: [person('dung')] })

        await send(id)

        expect(notifier.taskReminder).not.toHaveBeenCalled()
        expect((commandBus.execute.mock.calls[0]![0] as PostTaskDueCommand).due.userIds).toEqual(['binh'])
    })

    it('sends nothing for a task deleted, done, due at another time now, on a board turned off, or missed (ARCHITECTURE 7)', async () => {
        const { send, seed, notifier, commandBus } = setup()
        const done = seed({ status: 'done', completedAt: NOW })
        const moved = seed({ dueAt: new Date(IN_A_DAY.getTime() + 3600_000) })
        const off = seed({ channelId: 'hoi-dap' })
        // Run late: the 24-hour reminder with an hour left is missed (D-95).
        const soon = new Date(NOW.getTime() + 3600_000)
        const late = seed({ dueAt: soon })

        expect(await send('gone')).toBe(false)
        expect(await send(done)).toBe(false)
        expect(await send(moved)).toBe(false)
        expect(await send(off)).toBe(false)
        expect(await send(late, '24h', soon)).toBe(false)
        expect(notifier.taskReminder).not.toHaveBeenCalled()
        expect(commandBus.execute).not.toHaveBeenCalled()
    })

    it('fails the job when the inbox fails, before saying anything in the channel, for the queue to try again', async () => {
        const { send, seed, notifier, commandBus } = setup()
        notifier.taskReminder.mockRejectedValueOnce(new Error('connection lost'))
        await expect(send(seed())).rejects.toThrow('connection lost')
        expect(commandBus.execute).not.toHaveBeenCalled()
    })
})
