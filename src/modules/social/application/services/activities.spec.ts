import { socialWorld } from '../social-test-world.shared-spec'

const ENDS = new Date('2026-11-24T09:18:00Z')

describe('StudyActivities (D-240, D-247)', () => {
    it('gives each one shown what they study: the kind of room, their Solo, or both', async () => {
        const world = socialWorld()
        world.inRoom.set('an', 'phong-hoc')
        world.inRoom.set('binh', 'phong-voice')
        world.solos.set('binh', { status: 'paused', phase: 'focus', phaseEndsAt: null })
        world.solos.set('chi', { status: 'waiting', phase: 'short_break', phaseEndsAt: null })

        const activities = await world.activities.of(['an', 'binh', 'chi', 'dung'])

        expect(Object.fromEntries(activities)).toEqual({
            an: { room: 'study', solo: null },
            binh: { room: 'voice', solo: { status: 'paused', phase: 'focus', phaseEndsAt: null } },
            chi: { room: null, solo: { status: 'waiting', phase: 'short_break', phaseEndsAt: null } }
            // Dũng studies nowhere: left out.
        })
    })

    it('reads each source once for the whole list, and nothing more for those who show nothing', async () => {
        const world = socialWorld()
        world.activitySettings.set('an', { showStudyActivity: false, presence: 'online' })
        world.activitySettings.set('binh', { showStudyActivity: true, presence: 'invisible' })
        world.inRoom.set('chi', 'phong-nd')

        const activities = await world.activities.of(['an', 'binh', 'chi', 'dung', 'giang', 'chi'])

        expect([...activities.keys()]).toEqual(['chi'])
        expect(world.users.studyActivitySettingsOf).toHaveBeenCalledTimes(1)
        expect(world.voiceRooms.roomsOf).toHaveBeenCalledTimes(1)
        expect(world.voiceRooms.roomsOf).toHaveBeenCalledWith(['chi', 'dung'])
        expect(world.calls.inActiveCalls).toHaveBeenCalledWith(['chi', 'dung'])
        expect(world.soloSessions.solosOf).toHaveBeenCalledWith(['chi', 'dung'])
        expect(world.channels.studyRoomsAmong).toHaveBeenCalledTimes(1)
    })

    it('reads nothing past the settings when nobody asked shows anything', async () => {
        const world = socialWorld()
        world.activitySettings.set('an', { showStudyActivity: false, presence: 'online' })

        expect((await world.activities.of(['an', 'giang', 'ha'])).size).toBe(0)
        expect(world.voiceRooms.roomsOf).not.toHaveBeenCalled()
    })

    it('shows nothing of someone in an active call, a Solo included (spec 09 rule 7)', async () => {
        const world = socialWorld()
        world.solos.set('an', { status: 'running', phase: 'focus', phaseEndsAt: ENDS })
        world.callAs({ callerId: 'an', calleeId: 'binh', dmChannelId: 'dm-an-binh', status: 'active' })

        expect(await world.activities.ofOne('an')).toBeNull()
        world.callRows.get('call-1')!.status = 'ended'
        expect(await world.activities.ofOne('an')).toEqual({
            room: null,
            solo: { status: 'running', phase: 'focus', phaseEndsAt: ENDS }
        })
    })

    it('reads nothing for nobody', async () => {
        const world = socialWorld()
        expect((await world.activities.of([])).size).toBe(0)
        expect(world.users.studyActivitySettingsOf).not.toHaveBeenCalled()
    })
})
