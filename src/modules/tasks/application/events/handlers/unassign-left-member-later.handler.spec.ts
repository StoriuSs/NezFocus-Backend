import { Logger } from '@nestjs/common'
import { MemberChangedEvent } from '@/modules/servers'
import { TaskJobsPort } from '../../ports'
import { UnassignLeftMemberLaterHandler } from './unassign-left-member-later.handler'

describe('UnassignLeftMemberLaterHandler (REQ-TASK-04, D-195)', () => {
    const setUp = () => {
        const jobs = { unassignLeftMemberLater: jest.fn().mockResolvedValue(undefined) }
        return { jobs, handler: new UnassignLeftMemberLaterHandler(jobs as unknown as TaskJobsPort) }
    }

    it('queues taking off its tasks whoever left: by themselves, kicked, banned', async () => {
        const { jobs, handler } = setUp()

        await handler.handle(new MemberChangedEvent('nd', 'lan', 'left'))
        await handler.handle(new MemberChangedEvent('nd', 'nam', 'left', 'kick', 'Spam'))
        await handler.handle(new MemberChangedEvent('nd', 'khanh', 'left', 'ban', null))

        expect(jobs.unassignLeftMemberLater.mock.calls.map(([server, user]) => [server, user])).toEqual([
            ['nd', 'lan'],
            ['nd', 'nam'],
            ['nd', 'khanh']
        ])
        expect(jobs.unassignLeftMemberLater.mock.calls[0][2]).toBeInstanceOf(Date)
    })

    it('queues nothing for one who joined or changed', async () => {
        const { jobs, handler } = setUp()

        await handler.handle(new MemberChangedEvent('nd', 'lan', 'joined'))
        await handler.handle(new MemberChangedEvent('nd', 'lan', 'updated'))

        expect(jobs.unassignLeftMemberLater).not.toHaveBeenCalled()
    })

    it('says who and where when the job cannot be queued, so they can be taken off by hand', async () => {
        const { jobs, handler } = setUp()
        jobs.unassignLeftMemberLater.mockRejectedValueOnce(new Error('Redis down'))
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

        await expect(handler.handle(new MemberChangedEvent('nd', 'lan', 'left'))).rejects.toThrow('Redis down')
        expect(String(logged.mock.calls[0][0])).toContain('lan')
        expect(String(logged.mock.calls[0][0])).toContain('nd')
        logged.mockRestore()
    })
})
