import { NotifierPort } from '@/modules/notifications'
import { MemberChangedEvent } from '../member-changed.event'
import { NotifyModeratedMemberHandler } from './notify-moderated-member.handler'

const UNTIL = new Date('2026-11-18T15:30:00Z')

describe('NotifyModeratedMemberHandler (REQ-ROLE-04, D-188)', () => {
    const notifier = () => ({ memberModerated: jest.fn().mockResolvedValue(undefined) })

    it('gives one kicked, banned or timed out their moderation item, with the server name, why and until when', async () => {
        const told = notifier()
        const handler = new NotifyModeratedMemberHandler(told as unknown as NotifierPort)

        await handler.handle(
            new MemberChangedEvent('ot', 'dung', 'left', 'kick', 'Spam', null, {
                action: 'kick',
                serverName: 'ÔT',
                reason: 'Spam',
                timeoutUntil: null
            })
        )
        await handler.handle(
            new MemberChangedEvent('ot', 'dung', 'updated', null, null, null, {
                action: 'timeout',
                serverName: 'ÔT',
                reason: null,
                timeoutUntil: UNTIL
            })
        )

        expect(told.memberModerated.mock.calls).toEqual([
            [{ serverId: 'ot', serverName: 'ÔT' }, 'dung', { action: 'kick', reason: 'Spam', timeoutUntil: null }],
            [{ serverId: 'ot', serverName: 'ÔT' }, 'dung', { action: 'timeout', reason: null, timeoutUntil: UNTIL }]
        ])
    })

    it('says nothing of any other change: joining, leaving by oneself, a role, a timeout ended early', async () => {
        const told = notifier()
        const handler = new NotifyModeratedMemberHandler(told as unknown as NotifierPort)
        await handler.handle(new MemberChangedEvent('ot', 'dung', 'joined'))
        await handler.handle(new MemberChangedEvent('ot', 'dung', 'left'))
        await handler.handle(new MemberChangedEvent('ot', 'dung', 'updated'))
        expect(told.memberModerated).not.toHaveBeenCalled()
    })

    it('logs a failure instead of failing: the kick is done', async () => {
        const told = { memberModerated: jest.fn().mockRejectedValue(new Error('connection lost')) }
        const event = new MemberChangedEvent('ot', 'dung', 'left', 'ban', null, null, {
            action: 'ban',
            serverName: 'ÔT',
            reason: null,
            timeoutUntil: null
        })
        await expect(
            new NotifyModeratedMemberHandler(told as unknown as NotifierPort).handle(event)
        ).resolves.toBeUndefined()
    })
})
