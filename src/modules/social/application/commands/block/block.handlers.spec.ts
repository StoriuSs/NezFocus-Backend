import { RelationshipChangedEvent } from '../../events/relationship-changed.event'
import { socialWorld } from '../../social-test-world.shared-spec'
import { BlockUserCommand, UnblockUserCommand } from './block.commands'
import { BlockUserHandler, UnblockUserHandler } from './block.handlers'

describe('BlockUserHandler (REQ-SOCIAL-03, D-237, D-242)', () => {
    it('ends the friendship and adds the block, once', async () => {
        const world = socialWorld()
        world.befriend('an', 'binh')
        const handler = new BlockUserHandler(...world.deps)

        await expect(handler.execute(new BlockUserCommand('an', 'binh'))).resolves.toEqual({ write: 'block' })
        await expect(handler.execute(new BlockUserCommand('an', 'binh'))).resolves.toEqual({ write: 'nothing' })

        expect(world.rows.size).toBe(0)
        expect(world.stateOf('an', 'binh')).toEqual({ standing: 'none', blocking: true, blockedBy: false })
        expect(world.published(RelationshipChangedEvent)).toHaveLength(1)
    })

    it('blocks one who blocked me first: two blocks, each person their own', async () => {
        const world = socialWorld()
        world.block('binh', 'an')

        await new BlockUserHandler(...world.deps).execute(new BlockUserCommand('an', 'binh'))

        expect(world.stateOf('an', 'binh')).toEqual({ standing: 'none', blocking: true, blockedBy: true })
    })

    it.each([
        ['oneself', 'an'],
        ['an account waiting to be deleted (D-243)', 'giang']
    ])('finds no one to block: %s', async (_case, otherId) => {
        const world = socialWorld()
        await expect(
            new BlockUserHandler(...world.deps).execute(new BlockUserCommand('an', otherId))
        ).rejects.toMatchObject({
            errorKey: 'NOT_FOUND'
        })
    })
})

describe('UnblockUserHandler (D-237)', () => {
    it('takes my block off, and changes nothing when there is none of mine', async () => {
        const world = socialWorld()
        world.block('an', 'binh')
        world.block('chi', 'an')
        const handler = new UnblockUserHandler(...world.deps)

        await expect(handler.execute(new UnblockUserCommand('an', 'binh'))).resolves.toEqual({ write: 'unblock' })
        await expect(handler.execute(new UnblockUserCommand('an', 'chi'))).resolves.toEqual({ write: 'nothing' })

        expect(world.stateOf('an', 'binh').blocking).toBe(false)
        expect(world.stateOf('an', 'chi').blockedBy).toBe(true)
    })

    it('unblocks an account waiting to be deleted (D-243)', async () => {
        const world = socialWorld()
        world.block('an', 'giang')
        await expect(
            new UnblockUserHandler(...world.deps).execute(new UnblockUserCommand('an', 'giang'))
        ).resolves.toEqual({ write: 'unblock' })
    })
})
