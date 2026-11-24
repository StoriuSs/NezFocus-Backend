import { Call } from './call.rules'
import {
    CallPresence,
    callMediaFixes,
    CONNECT_MS,
    decideMediaTimeout,
    DROP_MS,
    LiveConnection,
    MEDIA_GRACE_MS,
    mediaDeadline,
    mediaWrite
} from './call-media.rules'

const acceptedAt = new Date('2026-11-24T21:44:06Z')
const at = (seconds: number) => new Date(acceptedAt.getTime() + seconds * 1000)

const activeCall = (changes: Partial<Call> = {}): Call => ({
    id: 'call-1',
    dmChannelId: 'dm-an-binh',
    callerId: 'an',
    calleeId: 'binh',
    video: false,
    status: 'active',
    endReason: null,
    version: 1,
    createdAt: at(-10),
    acceptedAt,
    endedAt: null,
    ...changes
})

const row = (userId: string, changes: Partial<CallPresence> = {}): CallPresence => ({
    userId,
    participantSid: `PA_${userId}`,
    joinedAt: at(2),
    leftAt: null,
    sessionId: `session-${userId}`,
    ...changes
})

const joined = (
    userId: string,
    changes: Partial<Extract<Parameters<typeof mediaWrite>[2], { kind: 'joined' }>> = {}
) => ({
    kind: 'joined' as const,
    userId,
    participantSid: `PA_${userId}`,
    joinedAt: at(2),
    sessionId: `session-${userId}`,
    ...changes
})

const left = (userId: string, participantSid = `PA_${userId}`, leftAt = at(20)) => ({
    kind: 'left' as const,
    userId,
    participantSid,
    at: leftAt
})

describe('mediaWrite (D-242: who is in a call media room)', () => {
    it('writes a party joining an active call', () => {
        expect(mediaWrite(activeCall(), [], joined('an'))).toEqual({ write: row('an'), evict: false })
    })

    it.each<[string, Call | null, string]>([
        ['a call over', activeCall({ status: 'ended', endedAt: at(30) }), 'an'],
        ['a call still ringing', activeCall({ status: 'ringing', acceptedAt: null }), 'an'],
        ['no call at all', null, 'an'],
        ['someone not of the call', activeCall(), 'chi']
    ])('puts out, writing nothing, a join to %s', (_, call, userId) => {
        expect(mediaWrite(call, [], joined(userId))).toEqual({ write: null, evict: true })
    })

    it('takes a newer connection of a party (a reload): in again', () => {
        const before = [row('an', { leftAt: at(20) })]
        const change = joined('an', { participantSid: 'PA_an_2', joinedAt: at(25), sessionId: 'session-an' })

        expect(mediaWrite(activeCall(), before, change)).toEqual({
            write: row('an', { participantSid: 'PA_an_2', joinedAt: at(25) }),
            evict: false
        })
    })

    it('leaves the row alone for a join of a connection older than its own, or one taken already', () => {
        const before = [row('an', { participantSid: 'PA_an_2', joinedAt: at(25) })]

        expect(mediaWrite(activeCall(), before, joined('an'))).toEqual({ write: null, evict: false })
        expect(mediaWrite(activeCall(), before, joined('an', { participantSid: 'PA_an_2', joinedAt: at(25) }))).toEqual(
            {
                write: null,
                evict: false
            }
        )
    })

    it('never takes back a connection that left (a list read before its leave)', () => {
        const before = [row('an', { leftAt: at(20) })]

        expect(mediaWrite(activeCall(), before, joined('an'))).toEqual({ write: null, evict: false })
    })

    it('writes when the connection of the row leaves', () => {
        expect(mediaWrite(activeCall(), [row('an')], left('an'))).toEqual({
            write: row('an', { leftAt: at(20) }),
            evict: false
        })
    })

    it.each<[string, CallPresence[], ReturnType<typeof left>]>([
        ['the leave of an older connection (a reload)', [row('an', { participantSid: 'PA_an_2' })], left('an')],
        ['a second leave', [row('an', { leftAt: at(10) })], left('an')],
        ['a leave with no row (a join never got through)', [], left('an')]
    ])('changes nothing for %s', (_, before, change) => {
        expect(mediaWrite(activeCall(), before, change)).toEqual({ write: null, evict: false })
    })

    it('changes nothing for a leave once the call is over: its room is closed', () => {
        const over = activeCall({ status: 'ended', endedAt: at(30) })

        expect(mediaWrite(over, [row('an')], left('an'))).toEqual({ write: null, evict: false })
    })
})

describe('mediaDeadline (REQ-SOCIAL-05, D-120, D-242: 15 seconds to connect, 30 to come back)', () => {
    it('gives a call answered 15 seconds for both to come in, failing then', () => {
        expect(mediaDeadline(activeCall(), [])).toEqual({
            at: at(15),
            to: { status: 'failed', endReason: null, endedAt: at(15) }
        })
        expect(mediaDeadline(activeCall(), [row('an')])?.at).toEqual(at(15))
        // One came and went: still not both, still the 15 seconds.
        expect(mediaDeadline(activeCall(), [row('an', { leftAt: at(5) })])?.to.status).toBe('failed')
    })

    it('has none while both are in', () => {
        expect(mediaDeadline(activeCall(), [row('an'), row('binh')])).toBeNull()
    })

    it('ends the call 30 seconds after the first of those out left, at the time they left', () => {
        const presence = [row('an', { leftAt: at(80) }), row('binh', { leftAt: at(70) })]

        expect(mediaDeadline(activeCall(), presence)).toEqual({
            at: at(70 + DROP_MS / 1000),
            to: { status: 'ended', endReason: null, endedAt: at(70) }
        })
    })

    it('has none for a call not active', () => {
        expect(mediaDeadline(activeCall({ status: 'ringing', acceptedAt: null }), [])).toBeNull()
        expect(mediaDeadline(activeCall({ status: 'ended', endedAt: at(9) }), [])).toBeNull()
    })

    it('counts the 15 seconds from answering', () => {
        expect(CONNECT_MS).toBe(15_000)
        expect(DROP_MS).toBe(30_000)
    })
})

describe('decideMediaTimeout (D-242)', () => {
    const presenceOut = [row('an'), row('binh', { leftAt: at(40) })]

    it('ends the call whose deadline passed, at the version its job was set for', () => {
        const call = activeCall({ version: 3 })

        expect(decideMediaTimeout('call-1', 3, presenceOut, [call], at(70))).toEqual({
            create: null,
            changes: [{ call, to: { status: 'ended', endReason: null, endedAt: at(40) } }],
            answer: 'call-1'
        })
    })

    it('fails a call nobody connected to in 15 seconds', () => {
        const call = activeCall()

        expect(decideMediaTimeout('call-1', 1, [row('an')], [call], at(15)).changes).toEqual([
            { call, to: { status: 'failed', endReason: null, endedAt: at(15) } }
        ])
    })

    it.each<[string, Call[], number, Date]>([
        ['the call changed since (someone came back)', [activeCall({ version: 4 })], 3, at(70)],
        ['its deadline not reached yet', [activeCall({ version: 3 })], 3, at(69)],
        ['the call over', [], 3, at(70)]
    ])('changes nothing: %s', (_, open, version, now) => {
        expect(decideMediaTimeout('call-1', version, presenceOut, open, now)).toEqual({
            create: null,
            changes: [],
            answer: 'call-1'
        })
    })

    it('changes nothing for a call whose two are in', () => {
        expect(decideMediaTimeout('call-1', 1, [row('an'), row('binh')], [activeCall()], at(99)).changes).toEqual([])
    })
})

describe('callMediaFixes (D-210, D-242: the reconciliation of a call room)', () => {
    const now = at(200)
    const live = (userId: string, changes: Partial<LiveConnection> = {}): LiveConnection => ({
        userId,
        participantSid: `PA_${userId}`,
        joinedAt: at(2),
        sessionId: `session-${userId}`,
        ...changes
    })

    it('adds a join for a connection the media server has and the rows lack', () => {
        expect(callMediaFixes([], [live('an')], now)).toEqual([joined('an')])
    })

    it('adds a leave, at the time it reads, for a row in the room the media server no longer has', () => {
        expect(callMediaFixes([row('an')], [], now)).toEqual([left('an', 'PA_an', now)])
    })

    it('leaves alone what agrees, and rows out already', () => {
        expect(callMediaFixes([row('an'), row('binh', { leftAt: at(9) })], [live('an')], now)).toEqual([])
    })

    it('gives a connection joined less than a minute before the read its webhook time', () => {
        const fresh = row('an', { joinedAt: new Date(now.getTime() - MEDIA_GRACE_MS + 1) })

        expect(callMediaFixes([fresh], [], now)).toEqual([])
    })

    it('passes on someone not of the call too: the join rule puts them out', () => {
        expect(callMediaFixes([], [live('chi')], now)).toEqual([joined('chi')])
    })
})
