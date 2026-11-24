/*
 * The study activity line (REQ-AUTH-07, D-79, D-240, D-247): what every
 * viewer may see of what someone studies now. The same for all of them:
 * the client adds the room's name and phase when it may view the room.
 * Who may see it at all (friends, those in a shared server) is the views'
 * to decide.
 */

export const ACTIVITY_ROOMS = ['study', 'voice'] as const
/** A study room (with a session or not), or another voice room. */
export type ActivityRoom = (typeof ACTIVITY_ROOMS)[number]

export const SOLO_STATUSES = ['running', 'paused', 'waiting'] as const
/** A Solo not ended: waiting is its break over, waiting for "Học tiếp". */
export type SoloStatus = (typeof SOLO_STATUSES)[number]

export const STUDY_PHASES = ['focus', 'short_break', 'long_break'] as const
export type StudyPhase = (typeof STUDY_PHASES)[number]

/** Someone's Solo, as the line shows it. */
export interface SoloActivity {
    status: SoloStatus
    phase: StudyPhase
    /** While running only: "còn N phút". */
    phaseEndsAt: Date | null
}

/** What every viewer may see; never both null (no activity is null as a whole). */
export interface Activity {
    room: ActivityRoom | null
    solo: SoloActivity | null
}

/** The two settings the line follows. */
export interface ActivitySettings {
    showStudyActivity: boolean
    /** The status chosen in the menu is "Ẩn": they show as offline. */
    invisible: boolean
}

/**
 * Whether anyone may see this person's line at all: "Show study activity"
 * on (by default) and not invisible (D-79). Null settings: an account gone.
 */
export const showsActivity = (settings: ActivitySettings | null): boolean =>
    !!settings && settings.showStudyActivity && !settings.invisible

/** What the line is worked out from. */
export interface ActivityFacts {
    /**
     * Their two settings: "Show study activity", and whether the status
     * chosen is invisible. Null for an account gone, waiting to be deleted
     * (D-182) or not completed.
     */
    settings: ActivitySettings | null
    /** In an active call (spec 09 rule 7). */
    inCall: boolean
    room: ActivityRoom | null
    solo: SoloActivity | null
}

/**
 * What changed, as far as telling the line goes: the two settings that hide
 * it, a call becoming active or ending, or anything about what one studies
 * (a voice room, a Solo, a room's kind).
 */
export type ActivityTrigger = 'settings' | 'call' | 'study'

/**
 * Whether a change is told to others at all (D-79, D-247): a null line told
 * on every change of someone hidden would beat out when they come and go and
 * how their Solo runs. So a change of what they study is told only while the
 * line shows (or shows nothing because they study nowhere), a call only
 * while not hidden, and the settings always: that is how a line comes back,
 * or goes.
 */
export function mayTellActivity(trigger: ActivityTrigger, facts: Pick<ActivityFacts, 'settings' | 'inCall'>): boolean {
    if (trigger === 'settings') return true
    if (!showsActivity(facts.settings)) return false
    return trigger === 'call' || !facts.inCall
}

/**
 * The line of one person, or null when it shows nothing: the switch off or
 * invisible (nobody sees it, Solo included), in a call, or studying nowhere.
 * A room and a Solo both: a voice room with no session does not end a Solo
 * (D-103), and the client chooses what to show.
 */
export function activityOf({ settings, inCall, room, solo }: ActivityFacts): Activity | null {
    if (!showsActivity(settings) || inCall) return null
    if (room === null && solo === null) return null
    return { room, solo }
}
