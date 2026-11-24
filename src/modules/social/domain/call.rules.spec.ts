import {
    Call,
    callSeconds,
    CallPlan,
    currentCallOf,
    decideAccept,
    decideCutOff,
    decideDecline,
    decideEnd,
    decideRingOut,
    decideStart,
    incomingCallsOf,
    isBusy
} from './call.rules'
import { CallInProgressError } from './errors/call.errors'

const at = new Date('2026-11-24T21:47:18Z')
let made = 0

/** A call of `callerId` to `calleeId` in their DM (`dm-<low>-<high>`), ringing unless told. */
function call(callerId: string, calleeId: string, changes: Partial<Call> = {}): Call {
    made += 1
    const [low, high] = [callerId, calleeId].sort()
    return {
        id: `call-${made}`,
        dmChannelId: `dm-${low}-${high}`,
        callerId,
        calleeId,
        video: false,
        status: 'ringing',
        endReason: null,
        version: 0,
        createdAt: new Date(at.getTime() - 10_000 + made),
        acceptedAt: null,
        endedAt: null,
        ...changes
    }
}

const active = (callerId: string, calleeId: string) =>
    call(callerId, calleeId, { status: 'active', acceptedAt: new Date(at.getTime() - 5000) })

const request = (callerId: string, calleeId: string) => {
    const [low, high] = [callerId, calleeId].sort()
    return { dmChannelId: `dm-${low}-${high}`, callerId, calleeId, video: false }
}

/** A plan as a list a table can read: what is made, then each change as `id → status (reason)`. */
const summary = (plan: CallPlan) => ({
    create: plan.create && `${plan.create.status}${plan.create.endReason ? ` (${plan.create.endReason})` : ''}`,
    changes: plan.changes.map(
        ({ call: changed, to }) =>
            `${changed.id} → ${to.status}${'endReason' in to && to.endReason ? ` (${to.endReason})` : ''}`
    ),
    answer: plan.answer
})

describe('the two states of a person (D-245)', () => {
    it('reads the call one makes or is in, and the calls ringing to one, oldest first', () => {
        const out = call('an', 'binh')
        const first = call('chi', 'dung')
        const second = call('giang', 'dung')
        const talking = active('ha', 'lan')
        const open = [out, second, first, talking]

        expect(currentCallOf(open, 'an')).toBe(out)
        expect(currentCallOf(open, 'binh')).toBeNull()
        expect(currentCallOf(open, 'lan')).toBe(talking)
        expect(incomingCallsOf(open, 'dung')).toEqual([first, second])
        expect(incomingCallsOf(open, 'binh')).toEqual([out])
    })

    it.each<[string, Call[], boolean]>([
        ['someone in no call', [], false],
        ['someone rung by one call', [call('an', 'binh')], false],
        [
            'someone rung by two calls already (a third card is not shown)',
            [call('an', 'binh'), call('chi', 'binh')],
            true
        ],
        ['someone ringing out (D-120)', [call('binh', 'chi')], true],
        ['someone in an active call, as caller', [active('binh', 'chi')], true],
        ['someone in an active call, as callee', [active('chi', 'binh')], true]
    ])('is busy when called: %s → %s', (_, open, busy) => {
        expect(isBusy(open, 'binh')).toBe(busy)
    })
})

describe('decideStart (REQ-SOCIAL-05, D-120, D-242, D-245)', () => {
    it('rings a free callee: a call made ringing, nothing else', () => {
        expect(summary(decideStart(request('an', 'binh'), [], at))).toEqual({
            create: 'ringing',
            changes: [],
            answer: 'new'
        })
    })

    it('makes a busy callee a missed call at once (busy), with no ring, mine left alone', () => {
        const mine = call('chi', 'an')
        const plan = decideStart(request('an', 'binh'), [mine, active('binh', 'dung')], at)

        expect(summary(plan)).toEqual({ create: 'missed (busy)', changes: [], answer: 'new' })
        expect(plan.create?.at).toBe(at)
    })

    it('misses as busy the calls ringing to me when I call out (D-245)', () => {
        const first = call('chi', 'an')
        const second = call('dung', 'an')

        expect(summary(decideStart(request('an', 'binh'), [first, second], at))).toEqual({
            create: 'ringing',
            changes: [`${first.id} → missed (busy)`, `${second.id} → missed (busy)`],
            answer: 'new'
        })
    })

    it('answers the call ringing to me from the one I call in the same DM: two calling each other meet in one', () => {
        const theirs = call('binh', 'an')
        const other = call('chi', 'an')

        expect(summary(decideStart(request('an', 'binh'), [theirs, other], at))).toEqual({
            create: null,
            changes: [`${theirs.id} → active`, `${other.id} → missed (busy)`],
            answer: theirs.id
        })
    })

    it.each<[string, (open: Call[]) => Call]>([
        ['my own call still ringing (a second click, another tab)', () => call('an', 'binh')],
        ['the call the two of us are in', () => active('binh', 'an')]
    ])('answers with %s as it is', (_, make) => {
        const here = make([])
        expect(summary(decideStart(request('an', 'binh'), [here], at))).toEqual({
            create: null,
            changes: [],
            answer: here.id
        })
    })

    it.each<[string, () => Call]>([
        ['ringing out to someone else', () => call('an', 'chi')],
        ['in an active call with someone else', () => active('chi', 'an')]
    ])('refuses me when I am %s (CALL_IN_PROGRESS)', (_, make) => {
        expect(() => decideStart(request('an', 'binh'), [make()], at)).toThrow(CallInProgressError)
    })
})

describe('decideAccept', () => {
    it('makes a call ringing to me active, the others ringing to me missed as busy (D-120)', () => {
        const mine = call('binh', 'an')
        const other = call('chi', 'an')
        const plan = decideAccept(mine.id, 'an', [mine, other], at)

        expect(summary(plan)).toEqual({
            create: null,
            changes: [`${mine.id} → active`, `${other.id} → missed (busy)`],
            answer: mine.id
        })
        expect(plan.changes[0]!.to).toEqual({ status: 'active', acceptedAt: at })
    })

    it.each<[string, () => { open: Call[]; id: string; userId: string }]>([
        ['a call cancelled meanwhile (no longer open)', () => ({ open: [], id: 'call-gone', userId: 'an' })],
        [
            'its caller asking',
            () => {
                const ringing = call('an', 'binh')
                return { open: [ringing], id: ringing.id, userId: 'an' }
            }
        ],
        [
            'a call answered already (another tab)',
            () => {
                const talking = active('binh', 'an')
                return { open: [talking], id: talking.id, userId: 'an' }
            }
        ]
    ])('changes nothing for %s (D-245)', (_, make) => {
        const { open, id, userId } = make()
        expect(summary(decideAccept(id, userId, open, at))).toEqual({ create: null, changes: [], answer: id })
    })
})

describe('decideDecline', () => {
    it('declines a call ringing to me, with no reason', () => {
        const mine = call('binh', 'an')
        const plan = decideDecline(mine.id, 'an', [mine], at)

        expect(summary(plan).changes).toEqual([`${mine.id} → declined`])
        expect(plan.changes[0]!.to).toEqual({ status: 'declined', endReason: null, endedAt: at })
    })

    it.each<[string, () => { open: Call[]; id: string }]>([
        [
            'my own call (its caller)',
            () => {
                const ringing = call('an', 'binh')
                return { open: [ringing], id: ringing.id }
            }
        ],
        [
            'a call I am in already',
            () => {
                const talking = active('binh', 'an')
                return { open: [talking], id: talking.id }
            }
        ],
        ['a call over', () => ({ open: [], id: 'call-over' })]
    ])('changes nothing for %s', (_, make) => {
        const { open, id } = make()
        expect(summary(decideDecline(id, 'an', open, at)).changes).toEqual([])
    })
})

describe('decideEnd (D-242)', () => {
    it.each<[string, () => Call, string, string]>([
        ['its caller, while it rings: cancelled', () => call('an', 'binh'), 'an', 'missed (cancelled)'],
        ['its callee, while it rings: declined', () => call('binh', 'an'), 'an', 'declined'],
        ['its caller, once active: ended', () => active('an', 'binh'), 'an', 'ended'],
        ['its callee, once active: ended', () => active('binh', 'an'), 'an', 'ended']
    ])('hangs up as %s', (_, make, userId, outcome) => {
        const open = make()
        expect(summary(decideEnd(open.id, userId, [open], at)).changes).toEqual([`${open.id} → ${outcome}`])
    })

    it('changes nothing for a call over already (the other one hung up first)', () => {
        expect(summary(decideEnd('call-over', 'an', [], at))).toEqual({
            create: null,
            changes: [],
            answer: 'call-over'
        })
    })
})

describe('decideRingOut (45 seconds)', () => {
    it('misses a call still ringing at its version (no_answer)', () => {
        const ringing = call('an', 'binh', { version: 0 })
        expect(summary(decideRingOut(ringing.id, 0, [ringing], at)).changes).toEqual([
            `${ringing.id} → missed (no_answer)`
        ])
    })

    it.each<[string, () => Call[], number]>([
        ['answered since (active)', () => [active('an', 'binh')], 0],
        ['changed since (another version)', () => [call('an', 'binh', { version: 1 })], 0],
        ['over since', () => [], 0]
    ])('changes nothing for a call %s', (_, make, version) => {
        const open = make()
        const id = open[0]?.id ?? 'call-over'
        expect(summary(decideRingOut(id, version, open, at)).changes).toEqual([])
    })
})

describe('decideCutOff (a block, an account waiting for deletion; D-242)', () => {
    it.each<[string, () => Call, string]>([
        ['an active call ends as any call does', () => active('an', 'binh'), 'ended'],
        ['a ringing call is missed as cancelled', () => call('an', 'binh'), 'missed (cancelled)']
    ])('%s', (_, make, outcome) => {
        const open = make()
        expect(summary(decideCutOff(open.id, [open], at)).changes).toEqual([`${open.id} → ${outcome}`])
    })

    it('changes nothing for a call over already', () => {
        expect(summary(decideCutOff('call-over', [], at)).changes).toEqual([])
    })
})

describe('callSeconds (D-242: from answering to the end)', () => {
    const acceptedAt = new Date('2026-11-24T21:44:06Z')

    it.each<[string, Pick<Call, 'status' | 'acceptedAt' | 'endedAt'>, number | null]>([
        ['an ended call', { status: 'ended', acceptedAt, endedAt: new Date('2026-11-24T21:47:21.900Z') }, 195],
        ['a failed call: no length (D-120)', { status: 'failed', acceptedAt, endedAt: at }, null],
        ['a missed call', { status: 'missed', acceptedAt: null, endedAt: at }, null],
        ['a declined call', { status: 'declined', acceptedAt: null, endedAt: at }, null]
    ])('%s → %s', (_, ended, seconds) => {
        expect(callSeconds(ended)).toBe(seconds)
    })
})
