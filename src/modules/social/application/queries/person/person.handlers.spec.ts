import { USER_LOOKUPS_PER_PERSON } from '../../rate-limits'
import { socialWorld } from '../../social-test-world.shared-spec'
import { GetPersonProfileQuery, LookUpPersonQuery } from './person.queries'
import { GetPersonProfileHandler, LookUpPersonHandler } from './person.handlers'

function setUp() {
    const world = socialWorld()
    const sources = [world.relationships, world.users, world.membership, world.presence] as const
    return {
        world,
        lookUp: (username: string) =>
            new LookUpPersonHandler(...sources, world.limit).execute(new LookUpPersonQuery('an', username)),
        profile: (otherId: string) =>
            new GetPersonProfileHandler(...sources).execute(new GetPersonProfileQuery('an', otherId))
    }
}

describe('LookUpPersonHandler (D-110)', () => {
    it('gives the card: who they are, where we stand, the servers we share, their presence there', async () => {
        const { world, lookUp } = setUp()
        world.befriend('binh', 'an', false, 'Chào An')

        await expect(lookUp('@Binh')).resolves.toEqual({
            user: { id: 'binh', username: 'binh', displayName: 'BINH', avatarUrl: 'https://cdn/binh.png' },
            bio: 'Bio of binh',
            presence: 'online',
            relationship: 'incoming',
            mutualServers: [{ id: 'ot', name: 'Ôn thi Giải tích 2' }]
        })
    })

    it('finds one who blocked me as anyone (REQ-SOCIAL-01), with no presence when we share nothing', async () => {
        const { world, lookUp } = setUp()
        world.block('chi', 'an')

        await expect(lookUp('chi')).resolves.toMatchObject({ relationship: 'none', presence: null, mutualServers: [] })
    })

    it.each([
        ['no such name', 'nobody'],
        ['oneself', 'an'],
        ['an account waiting to be deleted', 'giang']
    ])('finds no one: %s', async (_case, username) => {
        await expect(setUp().lookUp(username)).rejects.toMatchObject({ errorKey: 'NOT_FOUND' })
    })

    it('stops the 31st lookup of a minute, found or not', async () => {
        const { world, lookUp } = setUp()
        world.counts.set(`${USER_LOOKUPS_PER_PERSON.name}:an`, USER_LOOKUPS_PER_PERSON.limit)

        await expect(lookUp('binh')).rejects.toMatchObject({
            errorKey: 'RATE_LIMIT_EXCEEDED',
            details: { reason: 'user_lookup' }
        })
    })

    it('refuses while the counter cannot be reached: it stops walking the names', async () => {
        const { world, lookUp } = setUp()
        world.counter.down = true
        await expect(lookUp('binh')).rejects.toMatchObject({ errorKey: 'SERVICE_UNAVAILABLE' })
    })
})

describe('GetPersonProfileHandler (D-109, D-111)', () => {
    it('shows a friend with their presence even with no server shared', async () => {
        const { world, profile } = setUp()
        world.befriend('an', 'chi')

        await expect(profile('chi')).resolves.toMatchObject({
            relationship: 'friend',
            presence: 'offline',
            mutualServers: []
        })
    })

    it('shows an account waiting to be deleted as deleted: no name, no bio, no servers (D-182)', async () => {
        const { world, profile } = setUp()
        world.befriend('an', 'giang')

        await expect(profile('giang')).resolves.toEqual({
            user: { id: 'giang', username: null, displayName: null, avatarUrl: null },
            bio: null,
            presence: null,
            relationship: 'friend',
            mutualServers: []
        })
    })

    it('finds no profile of an account deleted for good or never completed', async () => {
        const { profile } = setUp()
        await expect(profile('ha')).rejects.toMatchObject({ errorKey: 'NOT_FOUND' })
        await expect(profile('khoa')).rejects.toMatchObject({ errorKey: 'NOT_FOUND' })
    })
})
