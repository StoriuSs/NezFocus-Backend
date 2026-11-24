import { socialWorld } from '../../social-test-world.shared-spec'
import { GetRelationshipQuery, ListMyRelationshipsQuery } from './relationship.queries'
import { GetRelationshipHandler, ListMyRelationshipsHandler } from './relationship.handlers'

describe('ListMyRelationshipsHandler (REQ-SOCIAL-02, D-242)', () => {
    it('lists friends, requests both ways and people I blocked, newest first; presence for friends only', async () => {
        const world = socialWorld()
        world.befriend('an', 'binh')
        world.befriend('chi', 'an', false, 'Mình là Chi')
        world.rows.get('an|chi')!.createdAt = new Date('2026-11-05T00:00:00Z')
        world.block('an', 'dung')
        world.befriend('an', 'giang')
        world.block('khoa', 'an')

        const list = await new ListMyRelationshipsHandler(
            world.relationships,
            world.users,
            world.presence,
            world.activities
        ).execute(new ListMyRelationshipsQuery('an'))

        expect(list.map(({ user, type, note, presence }) => [user.id, type, note, presence])).toEqual([
            ['chi', 'incoming', 'Mình là Chi', null],
            ['dung', 'blocked', null, null],
            ['binh', 'friend', null, 'online'],
            // Waiting to be deleted: kept, shown as deleted (D-243).
            ['giang', 'friend', null, 'offline']
        ])
        expect(list[3]!.user).toEqual({ id: 'giang', username: null, displayName: null, avatarUrl: null })
    })

    it('reads no presence when the list has no friend', async () => {
        const world = socialWorld()
        world.befriend('an', 'binh', false)

        await new ListMyRelationshipsHandler(
            world.relationships,
            world.users,
            world.presence,
            world.activities
        ).execute(new ListMyRelationshipsQuery('an'))

        expect(world.presence.everyoneShown).not.toHaveBeenCalled()
    })

    it('gives each friend’s study activity, nobody else’s, read once for the list (D-240, D-247)', async () => {
        const world = socialWorld()
        world.befriend('an', 'binh')
        world.befriend('an', 'chi')
        world.befriend('dung', 'an', false)
        world.inRoom.set('binh', 'phong-hoc')
        world.solos.set('chi', { status: 'running', phase: 'focus', phaseEndsAt: new Date('2026-11-24T09:18:00Z') })
        world.inRoom.set('dung', 'phong-voice')

        const list = await new ListMyRelationshipsHandler(
            world.relationships,
            world.users,
            world.presence,
            world.activities
        ).execute(new ListMyRelationshipsQuery('an'))

        expect(Object.fromEntries(list.map(({ user, activity }) => [user.id, activity]))).toEqual({
            binh: { room: 'study', solo: null },
            chi: {
                room: null,
                solo: { status: 'running', phase: 'focus', phaseEndsAt: new Date('2026-11-24T09:18:00Z') }
            },
            // A request: no presence, no activity.
            dung: null
        })
        expect(world.users.studyActivitySettingsOf).toHaveBeenCalledTimes(1)
    })
})

describe('GetRelationshipHandler (D-237, D-159)', () => {
    it('gives one person as I see them, none included, and nothing for an account gone for good', async () => {
        const world = socialWorld()
        const handler = new GetRelationshipHandler(world.relationships, world.users, world.presence, world.activities)

        await expect(handler.execute(new GetRelationshipQuery('an', 'binh'))).resolves.toMatchObject({
            type: 'none',
            since: null,
            presence: null
        })
        await expect(handler.execute(new GetRelationshipQuery('an', 'ha'))).resolves.toBeNull()
    })
})
