import { Cycle, FIRST_SOLO_CYCLE } from '../../../domain'
import { NOW, soloSession, studyWorld } from '../../study-test-world.shared-spec'
import { GetSoloSessionQuery } from './solo-session.queries'
import { GetSoloSessionHandler } from './solo-session.handlers'

const FIFTY: Cycle = { focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: null, longBreakEvery: null }

describe('GetSoloSessionHandler', () => {
    it('gives their Solo not yet ended, and its cycle as the next start’s', async () => {
        const world = studyWorld()
        world.put(soloSession({ cycle: FIFTY }), ['an'])
        const solo = await new GetSoloSessionHandler(world.repository).execute(new GetSoloSessionQuery('an'))
        expect(solo).toEqual({
            session: expect.objectContaining({
                id: 'solo',
                kind: 'solo',
                focusMinutes: 50,
                serverTime: expect.any(Date)
            }),
            startCycle: FIFTY
        })
    })

    it('gives no session once it ended, the cycle of the last one still (D-103), and 25/5 for one who never had one', async () => {
        const world = studyWorld()
        world.put(soloSession({ cycle: FIFTY, status: 'ended', endedAt: NOW, endedReason: 'stopped' }), ['an'])
        const handler = new GetSoloSessionHandler(world.repository)
        expect(await handler.execute(new GetSoloSessionQuery('an'))).toEqual({ session: null, startCycle: FIFTY })
        expect(await handler.execute(new GetSoloSessionQuery('binh'))).toEqual({
            session: null,
            startCycle: FIRST_SOLO_CYCLE
        })
    })
})
