import {
    channelOfRoom,
    joinOutcome,
    joinWrite,
    leaveApplies,
    leaveWrite,
    modMuteWrite,
    reasonForLeaving,
    reconcilePlan,
    selfStateWrite,
    VoiceConnection,
    voiceRoomOf
} from './voice-state.rules'

const A = '0190a000-0000-7000-8000-00000000000a'
const B = '0190a000-0000-7000-8000-00000000000b'
const at = (seconds: number) => new Date(Date.UTC(2026, 10, 18, 10, 0, seconds))
const connection = (over: Partial<VoiceConnection> = {}): VoiceConnection => ({
    userId: 'u1',
    channelId: A,
    participantSid: 'PA_1',
    joinedAt: at(0),
    ...over
})

describe('voice rooms (D-210)', () => {
    it('names the room of a channel, and reads only voice rooms back', () => {
        expect(voiceRoomOf(A)).toBe(`voice:${A}`)
        expect(channelOfRoom(voiceRoomOf(A))).toBe(A)
        expect(channelOfRoom(`call:${A}`)).toBeNull()
        expect(channelOfRoom('voice:probe')).toBeNull()
    })

    describe('a connection that joined', () => {
        it('is kept when the person had none', () => {
            expect(joinOutcome(null, connection())).toBe('new')
        })

        it('replaces an older connection, in this room or another', () => {
            const before = connection()
            expect(joinOutcome(before, connection({ participantSid: 'PA_2', joinedAt: at(5) }))).toBe('replace')
            expect(joinOutcome(before, connection({ channelId: B, participantSid: 'PA_2', joinedAt: at(5) }))).toBe(
                'replace'
            )
        })

        it('changes nothing told twice, or told after a newer one', () => {
            const now = connection({ participantSid: 'PA_2', joinedAt: at(5) })
            expect(joinOutcome(now, connection({ participantSid: 'PA_2', joinedAt: at(5) }))).toBe('ignore')
            expect(joinOutcome(now, connection({ participantSid: 'PA_1', joinedAt: at(0) }))).toBe('ignore')
        })
    })

    it('a connection that left takes only its own row away', () => {
        const now = connection({ participantSid: 'PA_2' })
        expect(leaveApplies(now, 'PA_2')).toBe(true)
        expect(leaveApplies(now, 'PA_1')).toBe(false)
        expect(leaveApplies(null, 'PA_1')).toBe(false)
    })

    describe('reconciliation', () => {
        // Two minutes after the first connection: past RECONCILE_GRACE_MS.
        const readAt = at(120)

        it('changes nothing when the rows are what LiveKit lists', () => {
            expect(reconcilePlan([connection()], [connection()], readAt)).toEqual({ join: [], drop: [], evict: [] })
        })

        it('keeps someone whose participant_joined was lost, in a room with no row', () => {
            const lost = connection({ channelId: B })
            expect(reconcilePlan([], [lost], readAt)).toEqual({ join: [lost], drop: [], evict: [] })
        })

        it('removes a row whose participant_left was lost', () => {
            const row = connection()
            expect(reconcilePlan([row], [], readAt)).toEqual({ join: [], drop: [row], evict: [] })
        })

        it('leaves alone a row of a connection that joined less than a minute before LiveKit was read', () => {
            const row = connection({ joinedAt: at(61) })
            expect(reconcilePlan([row], [], readAt)).toEqual({ join: [], drop: [], evict: [] })
        })

        it('leaves alone someone whose connection LiveKit lists joined less than a minute before: its webhook is on its way', () => {
            const young = connection({ joinedAt: at(61) })
            expect(reconcilePlan([], [young], readAt)).toEqual({ join: [], drop: [], evict: [] })
            const old = connection({ channelId: B, participantSid: 'PA_0', joinedAt: at(0) })
            expect(reconcilePlan([old], [young], readAt)).toEqual({ join: [], drop: [], evict: [] })
        })

        it('takes the newest connection of someone in two rooms, and puts them out of the other', () => {
            const old = connection()
            const newer = connection({ channelId: B, participantSid: 'PA_2', joinedAt: at(10) })
            expect(reconcilePlan([old], [old, newer], readAt)).toEqual({
                join: [newer],
                drop: [],
                evict: [{ channelId: A, userId: 'u1' }]
            })
        })

        it('replaces a row of a connection gone by the newer one LiveKit has', () => {
            const row = connection()
            const reload = connection({ participantSid: 'PA_2', joinedAt: at(10) })
            expect(reconcilePlan([row], [reload], readAt)).toEqual({ join: [reload], drop: [], evict: [] })
        })

        it('removes a row of a connection gone before keeping an older one LiveKit still has', () => {
            const row = connection({ channelId: B, participantSid: 'PA_2', joinedAt: at(10) })
            const older = connection()
            expect(reconcilePlan([row], [older], readAt)).toEqual({ join: [older], drop: [row], evict: [] })
        })
    })
})

describe('writes to a row', () => {
    const row = { ...connection(), micOn: false, cameraOn: false, screenSharing: false, modMuted: false }

    it('puts a connection that joined, unless told late', () => {
        const reload = connection({ participantSid: 'PA_2', joinedAt: at(5) })
        expect(joinWrite(row, reload)).toEqual({ kind: 'put', connection: reload })
        expect(joinWrite({ ...row, ...reload }, connection())).toBeNull()
    })

    it('removes the row only for its own connection', () => {
        expect(leaveWrite(row, 'PA_1')).toEqual({ kind: 'remove' })
        expect(leaveWrite(row, 'PA_2')).toBeNull()
    })

    it('writes the icons a browser reports, only when in a room and changed (D-206)', () => {
        expect(selfStateWrite(row, true, false)).toEqual({ kind: 'flags', flags: { micOn: true, cameraOn: false } })
        expect(selfStateWrite(row, false, false)).toBeNull()
        expect(selfStateWrite(null, true, true)).toBeNull()
    })

    it('keeps the microphone off while a moderator has it muted, whatever the browser says (D-212)', () => {
        const muted = { ...row, modMuted: true }
        expect(selfStateWrite(muted, true, true)).toEqual({ kind: 'flags', flags: { micOn: false, cameraOn: true } })
        expect(selfStateWrite(muted, true, false)).toBeNull()
    })

    it("mutes and unmutes someone in the room, turning the mic's icon off (D-207)", () => {
        expect(modMuteWrite({ ...row, micOn: true }, A, true)).toEqual({
            kind: 'flags',
            flags: { modMuted: true, micOn: false }
        })
        expect(modMuteWrite({ ...row, modMuted: true }, A, false)).toEqual({
            kind: 'flags',
            flags: { modMuted: false }
        })
    })

    it('mutes the connection they are on now: LiveKit acts on the person, a reload included', () => {
        expect(modMuteWrite({ ...row, participantSid: 'PA_reload' }, A, true)).toEqual({
            kind: 'flags',
            flags: { modMuted: true, micOn: false }
        })
    })

    it('writes nothing for a mute already so, someone in another room, or nobody (D-212)', () => {
        expect(modMuteWrite({ ...row, modMuted: true }, A, true)).toBeNull()
        expect(modMuteWrite(row, A, false)).toBeNull()
        expect(modMuteWrite(row, B, true)).toBeNull()
        expect(modMuteWrite(null, A, true)).toBeNull()
    })
})

describe('why someone left a server is why they left its room (SRS 5.2 voice.disconnected)', () => {
    it('says kick, ban, or that they left by themselves', () => {
        expect(reasonForLeaving('kick')).toBe('kick')
        expect(reasonForLeaving('ban')).toBe('ban')
        expect(reasonForLeaving(null)).toBe('server_left')
    })
})
