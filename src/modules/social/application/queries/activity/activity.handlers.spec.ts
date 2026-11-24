import { socialWorld } from '../../social-test-world.shared-spec'
import { ListActivitiesQuery } from './activity.queries'
import { ListActivitiesHandler } from './activity.handlers'

describe('ListActivitiesHandler (D-108, D-247)', () => {
    it('gives the line of each member who shows one, for the member list', async () => {
        const world = socialWorld()
        world.inRoom.set('binh', 'phong-hoc')

        const activities = await new ListActivitiesHandler(world.activities).execute(
            new ListActivitiesQuery(['an', 'binh'])
        )

        expect(Object.fromEntries(activities)).toEqual({ binh: { room: 'study', solo: null } })
    })
})
