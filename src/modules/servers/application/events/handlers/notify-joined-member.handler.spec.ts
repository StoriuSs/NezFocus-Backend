import { NotifierPort } from '@/modules/notifications'
import { MemberChangedEvent } from '../member-changed.event'
import { NotifyJoinedMemberHandler } from './notify-joined-member.handler'

describe('NotifyJoinedMemberHandler (D-202)', () => {
    const notifier = () => ({ memberJoined: jest.fn().mockResolvedValue(undefined) })

    it('tells NOTIFIER that one joined a server, so their old kick or ban there is read', async () => {
        const told = notifier()
        await new NotifyJoinedMemberHandler(told as unknown as NotifierPort).handle(
            new MemberChangedEvent('ot', 'dung', 'joined')
        )
        expect(told.memberJoined.mock.calls).toEqual([['ot', 'dung']])
    })

    it('says nothing of any other change', async () => {
        const told = notifier()
        const handler = new NotifyJoinedMemberHandler(told as unknown as NotifierPort)
        await handler.handle(new MemberChangedEvent('ot', 'dung', 'left', 'kick', null))
        await handler.handle(new MemberChangedEvent('ot', 'dung', 'updated'))
        expect(told.memberJoined).not.toHaveBeenCalled()
    })

    it('logs a failure instead of failing: the join is done', async () => {
        const told = { memberJoined: jest.fn().mockRejectedValue(new Error('connection lost')) }
        await expect(
            new NotifyJoinedMemberHandler(told as unknown as NotifierPort).handle(
                new MemberChangedEvent('ot', 'dung', 'joined')
            )
        ).resolves.toBeUndefined()
    })
})
