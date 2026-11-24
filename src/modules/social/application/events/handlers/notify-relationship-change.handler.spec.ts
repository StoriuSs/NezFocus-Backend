import { NotifierPort } from '@/modules/notifications'
import { afterWrite, NO_RELATIONSHIP, PairState, RelationshipWrite } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { RelationshipChangedEvent } from '../relationship-changed.event'
import { NotifyRelationshipChangeHandler } from './notify-relationship-change.handler'

type Written = Exclude<RelationshipWrite, { write: 'nothing' }>

const pair = (standing: PairState['standing']): PairState => ({ standing, blocking: false, blockedBy: false })

function setUp() {
    const world = socialWorld()
    const notifier = {
        friendRequested: jest.fn(),
        friendAccepted: jest.fn(),
        friendRequestClosed: jest.fn()
    }
    const handler = new NotifyRelationshipChangeHandler(notifier as unknown as NotifierPort, world.relationships)
    const handle = (before: PairState, write: Written) =>
        handler.handle(new RelationshipChangedEvent('an', 'binh', before, afterWrite(before, write), write))
    return { world, notifier, handle }
}

describe('NotifyRelationshipChangeHandler (NOTIF-01, NOTIF-03, D-111)', () => {
    it('gives the one asked a request item with its note', async () => {
        const { world, notifier, handle } = setUp()
        world.befriend('an', 'binh', false, 'Chào')
        await handle(NO_RELATIONSHIP, { write: 'request', note: 'Chào' })
        expect(notifier.friendRequested).toHaveBeenCalledWith('an', 'binh', 'Chào')
        expect(notifier.friendRequestClosed).not.toHaveBeenCalled()
    })

    it('takes the item off again when the request was answered or cancelled while it was written', async () => {
        const { notifier, handle } = setUp()
        // Cancelled at once: the pair has no request by the time the item is in.
        await handle(NO_RELATIONSHIP, { write: 'request', note: null })
        expect(notifier.friendRequestClosed).toHaveBeenCalledWith('an', 'binh')
    })

    it('tells the one who asked that it was accepted', async () => {
        const { notifier, handle } = setUp()
        await handle(pair('incoming'), { write: 'accept' })
        expect(notifier.friendAccepted).toHaveBeenCalledWith('binh', 'an')
    })

    it.each<[string, PairState, Written]>([
        ['declined', pair('incoming'), { write: 'remove' }],
        ['cancelled', pair('outgoing'), { write: 'remove' }],
        ['ended by a block', pair('outgoing'), { write: 'block' }]
    ])('takes the request item off once %s', async (_case, before, write) => {
        const { notifier, handle } = setUp()
        await handle(before, write)
        expect(notifier.friendRequestClosed).toHaveBeenCalledWith('an', 'binh')
    })

    it('writes nothing for an unfriending: no request was waiting', async () => {
        const { notifier, handle } = setUp()
        await handle(pair('friend'), { write: 'remove' })
        expect(
            [notifier.friendRequested, notifier.friendAccepted, notifier.friendRequestClosed].map(
                (fn) => fn.mock.calls.length
            )
        ).toEqual([0, 0, 0])
    })
})
