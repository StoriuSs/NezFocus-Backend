import { EventPublisherPort } from '@/modules/realtime'
import { afterWrite, NO_RELATIONSHIP, PairState, RelationshipWrite } from '../../../domain'
import { socialWorld } from '../../social-test-world.shared-spec'
import { RelationshipChangedEvent } from '../relationship-changed.event'
import { PublishRelationshipChangeHandler } from './publish-relationship-change.handler'

type Written = Exclude<RelationshipWrite, { write: 'nothing' }>

function setUp() {
    const world = socialWorld()
    const sent: { to: string; event: string; data: Record<string, unknown> }[] = []
    const publisher = {
        toUser: (to: string, event: string, data: Record<string, unknown>) => sent.push({ to, event, data })
    } as unknown as EventPublisherPort
    const handler = new PublishRelationshipChangeHandler(
        publisher,
        world.relationships,
        world.users,
        world.presence,
        world.activities
    )
    /** An wrote `write` to the pair with Bình, standing at `before` as she sees it. */
    const tell = async (before: PairState, write: Written) => {
        await world.relationships.change('an', 'binh', () => write, new Date())
        await handler.handle(new RelationshipChangedEvent('an', 'binh', before, afterWrite(before, write), write))
    }
    // Each side is told when its read is done: in no fixed order.
    const told = () =>
        sent
            .map(({ to, event, data }) => [to, event, (data.relationship as { type?: string })?.type ?? data.userId])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    return { world, tell, told, sent: () => sent }
}

describe('PublishRelationshipChangeHandler (SRS 5.2, D-242)', () => {
    it('adds a request to both lists, each as they see it', async () => {
        const { tell, told } = setUp()
        await tell(NO_RELATIONSHIP, { write: 'request', note: 'Chào' })
        expect(told()).toEqual([
            ['an', 'relationship.added', 'outgoing'],
            ['binh', 'relationship.added', 'incoming']
        ])
    })

    it('gives a new friend’s study activity with the friendship, as the list does (D-247)', async () => {
        const { world, tell, sent } = setUp()
        world.befriend('binh', 'an', false)
        world.inRoom.set('binh', 'phong-hoc')
        world.inRoom.set('an', 'phong-voice')

        await tell({ standing: 'incoming', blocking: false, blockedBy: false }, { write: 'accept' })

        const activityFor = (to: string) =>
            (sent().find((one) => one.to === to)?.data.relationship as { activity?: unknown } | undefined)?.activity
        expect(activityFor('an')).toEqual({ room: 'study', solo: null })
        expect(activityFor('binh')).toEqual({ room: 'voice', solo: null })
    })

    it('tells the one blocked only that the friendship went', async () => {
        const { world, tell, told } = setUp()
        world.befriend('an', 'binh')
        await tell({ standing: 'friend', blocking: false, blockedBy: false }, { write: 'block' })
        expect(told()).toEqual([
            ['an', 'relationship.updated', 'blocked'],
            ['binh', 'relationship.removed', 'an']
        ])
    })

    it('tells the one blocked nothing when there was nothing between them (REQ-SOCIAL-03)', async () => {
        const { tell, told } = setUp()
        await tell(NO_RELATIONSHIP, { write: 'block' })
        expect(told()).toEqual([['an', 'relationship.added', 'blocked']])
    })

    it('takes a declined request off the sender list too (D-111 c)', async () => {
        const { world, tell, told } = setUp()
        world.befriend('binh', 'an', false)
        await tell({ standing: 'incoming', blocking: false, blockedBy: false }, { write: 'remove' })
        expect(told()).toEqual([
            ['an', 'relationship.removed', 'binh'],
            ['binh', 'relationship.removed', 'an']
        ])
    })
})
