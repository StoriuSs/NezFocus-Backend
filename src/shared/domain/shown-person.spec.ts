import { isHidden, PersonFacts, shownPerson } from './shown-person'

const LIVE: PersonFacts = {
    id: 'u1',
    username: 'binh',
    displayName: 'Bình',
    avatarUrl: 'avatars/u1/face.webp',
    deletedAt: null,
    deletionRequestedAt: null
}
const GONE = { id: 'u1', username: null, displayName: null, avatarUrl: null }

describe('shownPerson (D-182)', () => {
    it('shows a live account as it is', () => {
        expect(isHidden(LIVE)).toBe(false)
        expect(shownPerson(LIVE)).toEqual({
            id: 'u1',
            username: 'binh',
            displayName: 'Bình',
            avatarUrl: 'avatars/u1/face.webp'
        })
    })

    it('shows an account waiting to be deleted as a deleted one: no names, no picture', () => {
        const waiting = { ...LIVE, deletionRequestedAt: new Date() }
        expect(isHidden(waiting)).toBe(true)
        expect(shownPerson(waiting)).toEqual(GONE)
    })

    it('hides the picture of a deleted account still kept until its file is cleaned up', () => {
        const deleted = { ...LIVE, username: null, displayName: null, deletedAt: new Date() }
        expect(isHidden(deleted)).toBe(true)
        expect(shownPerson(deleted)).toEqual(GONE)
    })
})
