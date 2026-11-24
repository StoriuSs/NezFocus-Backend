import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { CallView, GetCallQuery, JoinCallCommand } from '../../application'
import { CallNotFoundError } from '../../domain'
import { joinAnswer } from './join-answer'

const view = (status: CallView['status']) =>
    ({
        id: 'call-1',
        dmId: 'dm-an-binh',
        callerId: 'an',
        calleeId: 'binh',
        video: false,
        status,
        endReason: null,
        user: { id: 'an', username: 'an', displayName: 'An', avatarUrl: null },
        createdAt: new Date('2026-11-24T21:44:00Z'),
        acceptedAt: status === 'ringing' ? null : new Date('2026-11-24T21:44:06Z'),
        endedAt: null
    }) as CallView

function setUp(reads: (CallView | null)[], token: { token: string; url: string } | null) {
    const queryBus = { execute: jest.fn(async () => reads.shift() ?? null) }
    const commandBus = { execute: jest.fn(async () => token) }
    const answer = () =>
        joinAnswer(commandBus as unknown as CommandBus, queryBus as unknown as QueryBus, 'binh', 'call-1', 's-binh')
    return { answer, queryBus, commandBus }
}

describe('joinAnswer: POST /calls/{id}/join (D-246)', () => {
    it('gives an active call with its token', async () => {
        const { answer, commandBus, queryBus } = setUp([view('active')], { token: 'jwt', url: 'ws://lk' })

        await expect(answer()).resolves.toMatchObject({
            call: { id: 'call-1', status: 'active' },
            media: { token: 'jwt', url: 'ws://lk' }
        })
        expect(queryBus.execute).toHaveBeenCalledWith(new GetCallQuery('binh', 'call-1'))
        expect(commandBus.execute).toHaveBeenCalledWith(new JoinCallCommand('binh', 'call-1', 's-binh'))
    })

    it('gives a call still ringing as read, with no token, asking for none', async () => {
        const { answer, commandBus } = setUp([view('ringing')], null)

        await expect(answer()).resolves.toMatchObject({ call: { status: 'ringing' }, media: null })
        expect(commandBus.execute).not.toHaveBeenCalled()
    })

    it('never answers an active call with no token: one over between the read and the token is read again', async () => {
        const { answer } = setUp([view('active'), view('ended')], null)

        await expect(answer()).resolves.toMatchObject({ call: { status: 'ended' }, media: null })
    })

    it('finds no call for someone not of it', async () => {
        const { answer } = setUp([null], null)

        await expect(answer()).rejects.toThrow(CallNotFoundError)
    })
})
