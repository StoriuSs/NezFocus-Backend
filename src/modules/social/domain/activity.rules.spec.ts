import {
    Activity,
    ActivityFacts,
    activityOf,
    ActivityTrigger,
    mayTellActivity,
    showsActivity,
    SoloActivity
} from './activity.rules'

const ENDS = new Date('2026-11-24T09:18:00Z')
const focusing: SoloActivity = { status: 'running', phase: 'focus', phaseEndsAt: ENDS }

/** Someone shown, not in a call, studying nowhere: the facts each row changes. */
const facts = (changes: Partial<ActivityFacts> = {}): ActivityFacts => ({
    settings: { showStudyActivity: true, invisible: false },
    inCall: false,
    room: null,
    solo: null,
    ...changes
})

describe('showsActivity (D-79)', () => {
    it.each<[string, ActivityFacts['settings'], boolean]>([
        ['the switch on, a status shown', { showStudyActivity: true, invisible: false }, true],
        ['the switch off', { showStudyActivity: false, invisible: false }, false],
        ['invisible', { showStudyActivity: true, invisible: true }, false],
        ['an account gone', null, false]
    ])('%s → %s', (_, settings, expected) => {
        expect(showsActivity(settings)).toBe(expected)
    })
})

describe('mayTellActivity (D-79, D-247)', () => {
    const shown = { showStudyActivity: true, invisible: false }
    const hidden = { showStudyActivity: true, invisible: true }
    it.each<[string, ActivityTrigger, ActivityFacts['settings'], boolean, boolean]>([
        ['a room or a Solo of someone shown', 'study', shown, false, true],
        ['a room or a Solo of someone hidden: no beat of nulls', 'study', hidden, false, false],
        ['a Solo of someone in a call', 'study', shown, true, false],
        ['a call of someone shown', 'call', shown, true, true],
        ['a call of someone hidden', 'call', hidden, true, false],
        ['the switch or the status saved: the line comes back or goes', 'settings', hidden, false, true],
        ['the settings of someone in a call', 'settings', shown, true, true],
        ['anything of an account gone', 'study', null, false, false]
    ])('%s → %s', (_, trigger, settings, inCall, expected) => {
        expect(mayTellActivity(trigger, { settings, inCall })).toBe(expected)
    })
})

describe('activityOf (REQ-AUTH-07, D-79, D-240, D-247)', () => {
    it.each<[string, Partial<ActivityFacts>, Activity | null]>([
        ['in a study room', { room: 'study' }, { room: 'study', solo: null }],
        ['in another voice room', { room: 'voice' }, { room: 'voice', solo: null }],
        ['studying alone', { solo: focusing }, { room: null, solo: focusing }],
        [
            'a Solo waiting for "Học tiếp" (C-30 "hết giờ nghỉ")',
            { solo: { status: 'waiting', phase: 'short_break', phaseEndsAt: null } },
            { room: null, solo: { status: 'waiting', phase: 'short_break', phaseEndsAt: null } }
        ],
        [
            'a Solo in a voice room with no session: both, the client chooses (D-103)',
            { room: 'voice', solo: focusing },
            { room: 'voice', solo: focusing }
        ],
        ['studying nowhere', {}, null],
        [
            'the switch off: nobody sees it, Solo included',
            { settings: { showStudyActivity: false, invisible: false }, room: 'study', solo: focusing },
            null
        ],
        [
            'invisible ("Ẩn"): shows as offline, so no activity',
            { settings: { showStudyActivity: true, invisible: true }, room: 'study' },
            null
        ],
        ['in a call (spec 09 rule 7)', { inCall: true, solo: focusing }, null],
        ['an account gone or waiting to be deleted (D-182)', { settings: null, solo: focusing }, null]
    ])('%s', (_, changes, expected) => {
        expect(activityOf(facts(changes))).toEqual(expected)
    })
})
