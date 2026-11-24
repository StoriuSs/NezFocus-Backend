import { RelationshipChangedEvent } from '../../events/relationship-changed.event'
import { FRIEND_REQUESTS_PER_PERSON_DAY, USER_LOOKUPS_PER_PERSON } from '../../rate-limits'
import { socialWorld } from '../../social-test-world.shared-spec'
import {
    AcceptFriendRequestCommand,
    RemoveRelationshipCommand,
    RequestFriendByUsernameCommand,
    RequestFriendCommand
} from './relationship.commands'
import {
    AcceptFriendRequestHandler,
    RemoveRelationshipHandler,
    RequestFriendByUsernameHandler,
    RequestFriendHandler
} from './relationship.handlers'

// 23:30 on 24/11 in Hồ Chí Minh City, An's zone: her day ends in 30 minutes.
const NOW = new Date('2026-11-24T16:30:00Z')

describe('RequestFriendByUsernameHandler (REQ-SOCIAL-01, D-110, D-242)', () => {
    beforeEach(() => jest.useFakeTimers({ now: NOW }))
    afterEach(() => jest.useRealTimers())

    function setUp() {
        const world = socialWorld()
        const handler = new RequestFriendByUsernameHandler(...world.deps)
        return {
            world,
            ask: (username: string, note: string | null = null) =>
                handler.execute(new RequestFriendByUsernameCommand('an', username, note))
        }
    }

    it('asks by the name as the dialog writes it, keeps the note trimmed, and tells the change', async () => {
        const { world, ask } = setUp()

        await expect(ask('  @Binh ', '  Mình là An  ')).resolves.toEqual({ otherId: 'binh' })

        expect(world.rows.get('an|binh')).toMatchObject({ requesterId: 'an', accepted: false, note: 'Mình là An' })
        expect(world.published(RelationshipChangedEvent)).toEqual([
            expect.objectContaining({ actorId: 'an', otherId: 'binh', write: { write: 'request', note: 'Mình là An' } })
        ])
    })

    it('makes friends of two who ask each other, without counting a request', async () => {
        const { world, ask } = setUp()
        world.befriend('binh', 'an', false, 'Chào An')

        await ask('binh')

        expect(world.stateOf('an', 'binh').standing).toBe('friend')
        expect(world.counts.get(`friend-requests:an:2026-11-24`)).toBe(0)
    })

    it.each([
        ['no such name', 'nobody'],
        ['a name the pattern refuses', 'Có dấu'],
        ['oneself', 'an'],
        ['an account waiting to be deleted (D-182)', 'giang']
    ])('finds no one: %s', async (_case, username) => {
        const { world, ask } = setUp()
        await expect(ask(username)).rejects.toMatchObject({ errorKey: 'NOT_FOUND' })
        expect(world.relationships.change).not.toHaveBeenCalled()
    })

    it('refuses a second request while the first waits, and friends already', async () => {
        const { world, ask } = setUp()
        world.befriend('an', 'binh', false)
        world.befriend('an', 'chi')

        await expect(ask('binh')).rejects.toMatchObject({ errorKey: 'FRIEND_REQUEST_PENDING' })
        await expect(ask('chi')).rejects.toMatchObject({ errorKey: 'ALREADY_FRIENDS' })
        expect(world.published(RelationshipChangedEvent)).toEqual([])
    })

    it('refuses with the common error when either blocked the other (REQ-SOCIAL-03)', async () => {
        const { world, ask } = setUp()
        world.block('binh', 'an')
        world.block('an', 'chi')

        await expect(ask('binh')).rejects.toMatchObject({ errorKey: 'CANNOT_MESSAGE_USER' })
        await expect(ask('chi')).rejects.toMatchObject({ errorKey: 'CANNOT_MESSAGE_USER' })
    })

    it('counts only requests made, so a refusal gives its count back', async () => {
        const { world, ask } = setUp()
        world.befriend('an', 'chi')

        await ask('binh')
        await expect(ask('chi')).rejects.toBeDefined()

        expect(world.counts.get('friend-requests:an:2026-11-24')).toBe(1)
    })

    it('stops at 50 a day of the sender zone, until their midnight', async () => {
        const { world, ask } = setUp()
        world.counts.set('friend-requests:an:2026-11-24', FRIEND_REQUESTS_PER_PERSON_DAY.limit)

        const refused = ask('binh')

        await expect(refused).rejects.toMatchObject({
            errorKey: 'RATE_LIMIT_EXCEEDED',
            details: { reason: 'friend_requests' },
            retryAfterSeconds: 30 * 60
        })
        expect(world.rows.size).toBe(0)
        expect(world.counts.get('friend-requests:an:2026-11-24')).toBe(FRIEND_REQUESTS_PER_PERSON_DAY.limit)
    })

    it('still lets one at the limit accept by asking back: answering is not a new request', async () => {
        const { world, ask } = setUp()
        world.counts.set('friend-requests:an:2026-11-24', FRIEND_REQUESTS_PER_PERSON_DAY.limit)
        world.befriend('binh', 'an', false)

        await ask('binh')

        expect(world.stateOf('an', 'binh').standing).toBe('friend')
    })

    it('counts each name asked as a lookup (D-110): the 31st of a minute is refused, found or not', async () => {
        const { world, ask } = setUp()
        world.counts.set(`${USER_LOOKUPS_PER_PERSON.name}:an`, USER_LOOKUPS_PER_PERSON.limit)

        await expect(ask('nobody')).rejects.toMatchObject({
            errorKey: 'RATE_LIMIT_EXCEEDED',
            details: { reason: 'user_lookup' }
        })
        expect(world.users.findByUsername).not.toHaveBeenCalled()
    })

    it('refuses while the counter cannot be reached, as a lookup does: a name could be guessed uncounted', async () => {
        const { world, ask } = setUp()
        world.counter.down = true

        await expect(ask('binh')).rejects.toMatchObject({ errorKey: 'SERVICE_UNAVAILABLE' })
        expect(world.rows.size).toBe(0)
    })
})

describe('RequestFriendHandler, from a profile (D-237)', () => {
    it('asks with no note, and asking again or once friends changes nothing', async () => {
        const world = socialWorld()
        const handler = new RequestFriendHandler(...world.deps)

        await expect(handler.execute(new RequestFriendCommand('an', 'binh'))).resolves.toEqual({
            write: 'request',
            note: null
        })
        await expect(handler.execute(new RequestFriendCommand('an', 'binh'))).resolves.toEqual({ write: 'nothing' })
        world.befriend('an', 'chi')
        await expect(handler.execute(new RequestFriendCommand('an', 'chi'))).resolves.toEqual({ write: 'nothing' })
        expect(world.published(RelationshipChangedEvent)).toHaveLength(1)
    })

    it('goes on uncounted while the counter cannot be reached (D-242, as messages)', async () => {
        const world = socialWorld()
        world.counter.down = true

        await new RequestFriendHandler(...world.deps).execute(new RequestFriendCommand('an', 'binh'))

        expect(world.stateOf('an', 'binh').standing).toBe('outgoing')
        expect(world.limit.release).not.toHaveBeenCalled()
    })

    it.each([
        ['an account never completed', 'khoa'],
        ['an account deleted for good', 'ha'],
        ['an account waiting to be deleted (D-243)', 'giang'],
        ['no such account', 'nobody']
    ])('finds no one: %s', async (_case, otherId) => {
        const world = socialWorld()
        await expect(
            new RequestFriendHandler(...world.deps).execute(new RequestFriendCommand('an', otherId))
        ).rejects.toMatchObject({
            errorKey: 'NOT_FOUND'
        })
    })
})

describe('AcceptFriendRequestHandler (D-237)', () => {
    it('accepts their request, and again once friends changes nothing', async () => {
        const world = socialWorld()
        world.befriend('binh', 'an', false, 'Chào')
        const handler = new AcceptFriendRequestHandler(...world.deps)

        await expect(handler.execute(new AcceptFriendRequestCommand('an', 'binh'))).resolves.toEqual({
            write: 'accept'
        })
        await expect(handler.execute(new AcceptFriendRequestCommand('an', 'binh'))).resolves.toEqual({
            write: 'nothing'
        })
        expect(world.rows.get('an|binh')).toMatchObject({ accepted: true, note: null })
    })

    it('finds no request to accept once it was cancelled, nor a request of mine', async () => {
        const world = socialWorld()
        world.befriend('an', 'chi', false)
        const handler = new AcceptFriendRequestHandler(...world.deps)

        await expect(handler.execute(new AcceptFriendRequestCommand('an', 'binh'))).rejects.toMatchObject({
            errorKey: 'NOT_FOUND'
        })
        await expect(handler.execute(new AcceptFriendRequestCommand('an', 'chi'))).rejects.toMatchObject({
            errorKey: 'NOT_FOUND'
        })
    })

    it('does not accept from an account waiting to be deleted (D-243)', async () => {
        const world = socialWorld()
        world.befriend('giang', 'an', false)
        await expect(
            new AcceptFriendRequestHandler(...world.deps).execute(new AcceptFriendRequestCommand('an', 'giang'))
        ).rejects.toMatchObject({ errorKey: 'NOT_FOUND' })
    })
})

describe('RemoveRelationshipHandler (D-237)', () => {
    it.each([
        ['declines their request', 'binh', 'an', false],
        ['cancels mine', 'an', 'binh', false],
        ['unfriends', 'an', 'binh', true]
    ])('%s', async (_case, requesterId, otherId, accepted) => {
        const world = socialWorld()
        world.befriend(requesterId, otherId, accepted)

        await new RemoveRelationshipHandler(...world.deps).execute(new RemoveRelationshipCommand('an', 'binh'))

        expect(world.rows.size).toBe(0)
        expect(world.published(RelationshipChangedEvent)).toHaveLength(1)
    })

    it('changes nothing with nothing there, and lets go of a friend waiting to be deleted (D-243)', async () => {
        const world = socialWorld()
        world.befriend('an', 'giang')
        const handler = new RemoveRelationshipHandler(...world.deps)

        await expect(handler.execute(new RemoveRelationshipCommand('an', 'binh'))).resolves.toEqual({
            write: 'nothing'
        })
        await expect(handler.execute(new RemoveRelationshipCommand('an', 'giang'))).resolves.toEqual({
            write: 'remove'
        })
        expect(world.published(RelationshipChangedEvent)).toHaveLength(1)
    })

    it('finds no one to remove: oneself', async () => {
        const world = socialWorld()
        await expect(
            new RemoveRelationshipHandler(...world.deps).execute(new RemoveRelationshipCommand('an', 'an'))
        ).rejects.toMatchObject({ errorKey: 'NOT_FOUND' })
    })
})
