import { isShownDm, mayMessage, MessagingFacts } from './dm.rules'

/** A stranger who lets server members write, sharing no server: the facts each row changes. */
const facts = (changes: Partial<MessagingFacts> = {}): MessagingFacts => ({
    gone: false,
    blocked: false,
    friends: false,
    sharesServer: false,
    allowsServerMembers: true,
    ...changes
})

describe('mayMessage (REQ-SOCIAL-04, REQ-SOCIAL-03, D-242)', () => {
    it.each<[string, Partial<MessagingFacts>, boolean]>([
        ['a friend', { friends: true }, true],
        [
            'a friend who lets no server member write: friends need no setting',
            { friends: true, allowsServerMembers: false },
            true
        ],
        ['someone in a shared server who lets server members write', { sharesServer: true }, true],
        ['someone in a shared server who turned it off', { sharesServer: true, allowsServerMembers: false }, false],
        ['a stranger: no friendship, no server shared', {}, false],
        ['a friend across a block, either way', { friends: true, blocked: true }, false],
        ['someone in a shared server across a block', { sharesServer: true, blocked: true }, false],
        ['a friend whose account is deleted or waiting to be (D-182)', { friends: true, gone: true }, false],
        ['someone in a shared server whose account is gone', { sharesServer: true, gone: true }, false]
    ])('%s → %s', (_, changes, expected) => {
        expect(mayMessage(facts(changes))).toBe(expected)
    })
})

describe('isShownDm (D-244)', () => {
    const closed = new Date('2026-11-24T08:00:00Z')
    const before = new Date('2026-11-24T07:59:00Z')
    const after = new Date('2026-11-24T08:01:00Z')

    it.each<[string, Date | null, Date | null, boolean]>([
        ['never closed, no message yet', null, null, true],
        ['never closed, with messages', null, before, true],
        ['closed, nothing said since', closed, before, false],
        ['closed, nothing ever said (a DM the other one just made)', closed, null, false],
        ['closed, a message at the very moment it closed: not after it', closed, closed, false],
        ['closed, a message after: shown again', closed, after, true]
    ])('%s → %s', (_, closedAt, lastMessageAt, expected) => {
        expect(isShownDm(closedAt, lastMessageAt)).toBe(expected)
    })
})
