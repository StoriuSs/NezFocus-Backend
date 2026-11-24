import { Inject, Injectable } from '@nestjs/common'
import { CHANNEL_DIRECTORY, type ChannelDirectoryPort } from '@/modules/servers'
import { SOLO_SESSIONS, type SoloSessionsPort } from '@/modules/study'
import { USER_DIRECTORY, type UserDirectoryPort } from '@/modules/users'
import { VOICE_ROOMS, type VoiceRoomsPort } from '@/modules/voice'
import {
    Activity,
    activityOf,
    ActivitySettings,
    CALL_REPOSITORY,
    type CallRepositoryPort,
    showsActivity
} from '../../domain'

/** One person's line and what decided whether it shows: for telling it (mayTellActivity). */
export interface ActivityRead {
    activity: Activity | null
    /** Null for an account gone, waiting to be deleted or not completed. */
    settings: ActivitySettings | null
    /** Read only for someone shown; false for anyone else. */
    inCall: boolean
}

/**
 * The study activity line of people (D-240, D-247), the same for every
 * viewer: each source read once for them all, whatever their number, so a
 * list of 200 friends costs as much as one. Who may see it is the caller's
 * to decide: where their presence is shown (D-242).
 */
@Injectable()
export class StudyActivities {
    constructor(
        @Inject(USER_DIRECTORY) private readonly users: UserDirectoryPort,
        @Inject(CALL_REPOSITORY) private readonly calls: CallRepositoryPort,
        @Inject(VOICE_ROOMS) private readonly voiceRooms: VoiceRoomsPort,
        @Inject(CHANNEL_DIRECTORY) private readonly channels: ChannelDirectoryPort,
        @Inject(SOLO_SESSIONS) private readonly solos: SoloSessionsPort
    ) {}

    /** The activity of each of `userIds` who shows one; anyone left out shows none. */
    async of(userIds: string[]): Promise<Map<string, Activity>> {
        const read = await this.read(userIds)
        return new Map([...read].flatMap(([id, { activity }]) => (activity ? [[id, activity] as const] : [])))
    }

    /** One person's line, or null. */
    async ofOne(userId: string): Promise<Activity | null> {
        return (await this.of([userId])).get(userId) ?? null
    }

    /** The line of each of `userIds`, with the facts that decided it. */
    async read(userIds: string[]): Promise<Map<string, ActivityRead>> {
        const ids = [...new Set(userIds)]
        if (ids.length === 0) return new Map()
        const stored = await this.users.studyActivitySettingsOf(ids)
        const settings = new Map<string, ActivitySettings>(
            [...stored].map(([id, mine]) => [
                id,
                { showStudyActivity: mine.showStudyActivity, invisible: mine.presence === 'invisible' }
            ])
        )
        const lines = new Map<string, ActivityRead>(
            ids.map((id) => [id, { activity: null, settings: settings.get(id) ?? null, inCall: false }])
        )
        // What the others study is not read: they show nothing anyway.
        const shown = ids.filter((id) => showsActivity(settings.get(id) ?? null))
        if (shown.length === 0) return lines
        const [inCalls, rooms, solos] = await Promise.all([
            this.calls.inActiveCalls(shown),
            this.voiceRooms.roomsOf(shown),
            this.solos.solosOf(shown)
        ])
        const studyRooms = new Set(
            await this.channels.studyRoomsAmong([...new Set(rooms.map((room) => room.channelId))])
        )
        const calling = new Set(inCalls)
        const roomOf = new Map(rooms.map((room) => [room.userId, room.channelId]))
        const soloOf = new Map(solos.map(({ userId, ...solo }) => [userId, solo]))
        for (const id of shown) {
            const channelId = roomOf.get(id)
            const line = lines.get(id)!
            line.inCall = calling.has(id)
            line.activity = activityOf({
                settings: line.settings,
                inCall: line.inCall,
                // A room of a server just deleted is a voice room until voice empties it (D-212).
                room: channelId === undefined ? null : studyRooms.has(channelId) ? 'study' : 'voice',
                solo: soloOf.get(id) ?? null
            })
        }
        return lines
    }
}
