import {
    afterWrite,
    decideRelationship,
    flip,
    keptNote,
    listChange,
    NO_RELATIONSHIP,
    PairState,
    RelationshipAction,
    RelationshipDecision,
    requestClosed,
    shownType,
    Standing
} from './relationship.rules'

const pair = (standing: Standing, blocking = false, blockedBy = false): PairState => ({
    standing,
    blocking,
    blockedBy
})

const byUsername: RelationshipAction = { kind: 'request', from: 'username', note: 'Mình là An' }
const fromProfile: RelationshipAction = { kind: 'request', from: 'profile', note: null }

describe('decideRelationship (REQ-SOCIAL-01, REQ-SOCIAL-03, D-237, D-242)', () => {
    describe('a request', () => {
        it.each<[string, PairState, RelationshipAction, RelationshipDecision]>([
            [
                'to a stranger: a new request with its note',
                NO_RELATIONSHIP,
                byUsername,
                { write: 'request', note: 'Mình là An' }
            ],
            ['from a profile: a new request', NO_RELATIONSHIP, fromProfile, { write: 'request', note: null }],
            [
                'to one who asked me first: accepted (asking each other)',
                pair('incoming'),
                byUsername,
                { write: 'accept' }
            ],
            ['from a profile to one who asked me: accepted', pair('incoming'), fromProfile, { write: 'accept' }],
            [
                'by username, mine still waiting: FRIEND_REQUEST_PENDING',
                pair('outgoing'),
                byUsername,
                { refused: 'pending' }
            ],
            ['by username, friends: ALREADY_FRIENDS', pair('friend'), byUsername, { refused: 'friends' }],
            ['from a profile, mine still waiting: nothing', pair('outgoing'), fromProfile, { write: 'nothing' }],
            ['from a profile, friends: nothing', pair('friend'), fromProfile, { write: 'nothing' }],
            [
                'to one who blocked me: CANNOT_MESSAGE_USER',
                pair('none', false, true),
                byUsername,
                { refused: 'blocked' }
            ],
            ['to one I blocked: CANNOT_MESSAGE_USER too', pair('none', true), fromProfile, { refused: 'blocked' }]
        ])('%s', (_case, state, action, decision) => {
            expect(decideRelationship(state, action, true)).toEqual(decision)
        })

        it('is refused once the day is used up, but answering a request is not a new one', () => {
            expect(decideRelationship(NO_RELATIONSHIP, byUsername, false)).toEqual({ refused: 'limit' })
            expect(decideRelationship(pair('incoming'), byUsername, false)).toEqual({ write: 'accept' })
            expect(decideRelationship(pair('outgoing'), byUsername, false)).toEqual({ refused: 'pending' })
        })

        it('says a block before anything the day decides', () => {
            expect(decideRelationship(pair('none', false, true), byUsername, false)).toEqual({ refused: 'blocked' })
        })
    })

    it.each<[string, PairState, RelationshipDecision]>([
        ['their request: accepted', pair('incoming'), { write: 'accept' }],
        ['friends already (another tab): nothing', pair('friend'), { write: 'nothing' }],
        ['their request cancelled meanwhile: no request', NO_RELATIONSHIP, { refused: 'no_request' }],
        ['my own request: no request of theirs', pair('outgoing'), { refused: 'no_request' }]
    ])('accepting %s', (_case, state, decision) => {
        expect(decideRelationship(state, { kind: 'accept' }, true)).toEqual(decision)
    })

    it.each<[string, PairState, RelationshipDecision]>([
        ['their request: declined', pair('incoming'), { write: 'remove' }],
        ['my request: cancelled', pair('outgoing'), { write: 'remove' }],
        ['a friend: unfriended', pair('friend'), { write: 'remove' }],
        ['nothing: nothing', NO_RELATIONSHIP, { write: 'nothing' }],
        ['one I blocked: the block stays', pair('none', true), { write: 'nothing' }]
    ])('removing %s', (_case, state, decision) => {
        expect(decideRelationship(state, { kind: 'remove' }, true)).toEqual(decision)
    })

    it('blocks whatever stands, once', () => {
        for (const standing of ['none', 'outgoing', 'incoming', 'friend'] as const) {
            expect(decideRelationship(pair(standing), { kind: 'block' }, true)).toEqual({ write: 'block' })
        }
        expect(decideRelationship(pair('none', false, true), { kind: 'block' }, true)).toEqual({ write: 'block' })
        expect(decideRelationship(pair('none', true), { kind: 'block' }, true)).toEqual({ write: 'nothing' })
    })

    it('unblocks only a block of mine', () => {
        expect(decideRelationship(pair('none', true), { kind: 'unblock' }, true)).toEqual({ write: 'unblock' })
        expect(decideRelationship(pair('none', false, true), { kind: 'unblock' }, true)).toEqual({ write: 'nothing' })
    })
})

describe('what each side sees (D-242)', () => {
    it('flips the request and the blocks for the other one', () => {
        expect(flip(pair('outgoing', true, false))).toEqual(pair('incoming', false, true))
        expect(flip(pair('friend'))).toEqual(pair('friend'))
    })

    it('shows a block of mine, never one of theirs', () => {
        expect(shownType(pair('none', true))).toBe('blocked')
        expect(shownType(pair('none', false, true))).toBe('none')
    })

    it('tells the one blocked only that the friendship went', () => {
        const before = pair('friend')
        const after = afterWrite(before, { write: 'block' })
        expect(listChange(before, after)).toBe('updated')
        expect(listChange(flip(before), flip(after))).toBe('removed')
    })

    it('tells the one blocked nothing when there was nothing between them', () => {
        const after = afterWrite(NO_RELATIONSHIP, { write: 'block' })
        expect(listChange(NO_RELATIONSHIP, after)).toBe('added')
        expect(listChange(flip(NO_RELATIONSHIP), flip(after))).toBeNull()
    })

    it('adds a request to both lists, and turns both into friends on accepting', () => {
        const asked = afterWrite(NO_RELATIONSHIP, { write: 'request', note: null })
        expect([listChange(NO_RELATIONSHIP, asked), listChange(NO_RELATIONSHIP, flip(asked))]).toEqual([
            'added',
            'added'
        ])
        const accepted = afterWrite(flip(asked), { write: 'accept' })
        expect(listChange(flip(asked), accepted)).toBe('updated')
        expect(listChange(asked, flip(accepted))).toBe('updated')
    })

    it('takes a declined request off the sender list too (D-111 c)', () => {
        const before = pair('incoming')
        const after = afterWrite(before, { write: 'remove' })
        expect(listChange(flip(before), flip(after))).toBe('removed')
    })

    it('says a request closed when it was waiting and is no longer', () => {
        expect(requestClosed(pair('incoming'), pair('friend'))).toBe(true)
        expect(requestClosed(pair('outgoing'), afterWrite(pair('outgoing'), { write: 'block' }))).toBe(true)
        expect(requestClosed(pair('friend'), pair('none'))).toBe(false)
        expect(requestClosed(pair('outgoing'), pair('outgoing'))).toBe(false)
    })
})

describe('keptNote', () => {
    it('trims, and keeps none for an empty note', () => {
        expect(keptNote('  Chào  ')).toBe('Chào')
        expect(keptNote('   ')).toBeNull()
        expect(keptNote(undefined)).toBeNull()
    })
})
