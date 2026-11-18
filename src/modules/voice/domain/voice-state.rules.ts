/**
 * Who is in which voice room (VoiceState), and how LiveKit's word on it is
 * taken (D-210). LiveKit's webhooks are the truth, but one can come twice,
 * late or never: these rules decide what each changes, so the same answer
 * comes whether a webhook, the reconciliation or a person leaving got there
 * first.
 */

/** A person's connection to a voice room, as kept by the API. */
export interface VoiceConnection {
    userId: string
    channelId: string
    /** LiveKit's id of the connection: a reload or another room makes a new one. */
    participantSid: string
    /** When LiveKit says the connection joined. */
    joinedAt: Date
}

/** A person in a room now, with the icons beside their name (D-206, D-207, D-101). */
export interface VoiceState extends VoiceConnection {
    micOn: boolean
    cameraOn: boolean
    screenSharing: boolean
    modMuted: boolean
}

const ROOM_PREFIX = 'voice:'
// Ids are UUIDs (version 7 for channels); anything else in a room's name is no channel of ours.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The LiveKit room of a voice channel (ARCHITECTURE 4). */
export const voiceRoomOf = (channelId: string): string => `${ROOM_PREFIX}${channelId}`

/**
 * The voice channel a LiveKit room is for; null for any other room (calls,
 * `call:<id>`, come with M6), so a webhook about one is left alone here.
 */
export function channelOfRoom(room: string): string | null {
    if (!room.startsWith(ROOM_PREFIX)) return null
    const channelId = room.slice(ROOM_PREFIX.length)
    return UUID.test(channelId) ? channelId : null
}

/**
 * What a connection that joined does to the person's row (D-210):
 * - `new`: they had none;
 * - `replace`: a newer connection, in this room (a reload) or another;
 * - `ignore`: the same connection told again, or an older one told late
 *   (the participant_joined of the room they left, after the one they are in).
 */
export function joinOutcome(current: VoiceConnection | null, joined: VoiceConnection): 'new' | 'replace' | 'ignore' {
    if (!current) return 'new'
    if (current.participantSid === joined.participantSid) return 'ignore'
    if (current.joinedAt.getTime() > joined.joinedAt.getTime()) return 'ignore'
    return 'replace'
}

/**
 * Whether a connection that left takes the person's row away: only when it
 * is the one the row holds. The participant_left of the old connection can
 * come after the participant_joined of the new one (D-210).
 */
export const leaveApplies = (current: VoiceConnection | null, participantSid: string): boolean =>
    current?.participantSid === participantSid

/** What the reconciliation changes (D-210). */
export interface ReconcilePlan {
    /** Connections LiveKit has and the rows lack: kept as a participant_joined would be. */
    join: VoiceConnection[]
    /** Rows of connections LiveKit no longer has: removed as a participant_left would. */
    drop: VoiceConnection[]
    /** Older connections of someone also connected elsewhere: put out of that room (one connection per account). */
    evict: { channelId: string; userId: string }[]
}

/**
 * How recent a connection the reconciliation leaves alone, whether a row
 * holds it or LiveKit lists it: its webhook, or a request of its person, may
 * be on its way while LiveKit is read. A lost webhook is set right at the
 * first run after this.
 */
export const RECONCILE_GRACE_MS = 60 * 1000

/**
 * The rows set against what LiveKit listed after `readAt`, every room either
 * side has (D-210). Per person, their newest connection is the one they are
 * in: the row comes to hold it, and any other is put out. Someone with a
 * connection that joined less than RECONCILE_GRACE_MS before `readAt`, in
 * the rows or in LiveKit's list, is left alone this time.
 */
export function reconcilePlan(rows: VoiceConnection[], live: VoiceConnection[], readAt: Date): ReconcilePlan {
    const plan: ReconcilePlan = { join: [], drop: [], evict: [] }
    const liveOf = new Map<string, VoiceConnection[]>()
    for (const connection of live) {
        liveOf.set(connection.userId, [...(liveOf.get(connection.userId) ?? []), connection])
    }
    const rowOf = new Map(rows.map((row) => [row.userId, row]))

    const recent = (connection: VoiceConnection) =>
        connection.joinedAt.getTime() > readAt.getTime() - RECONCILE_GRACE_MS

    for (const userId of new Set([...rowOf.keys(), ...liveOf.keys()])) {
        const row = rowOf.get(userId) ?? null
        const connections = [...(liveOf.get(userId) ?? [])].sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
        if ((row && recent(row)) || connections.some(recent)) continue
        const [newest, ...older] = connections
        // A row of a connection gone: a newer one replaces it as it joins;
        // with none, or only older ones, it goes first.
        const gone = row && !connections.some((connection) => connection.participantSid === row.participantSid)
        if (gone && (!newest || joinOutcome(row, newest) === 'ignore')) plan.drop.push(row)
        if (!newest) continue
        if (row?.participantSid !== newest.participantSid) plan.join.push(newest)
        for (const connection of older) {
            if (connection.channelId !== newest.channelId) plan.evict.push({ channelId: connection.channelId, userId })
        }
    }
    return plan
}

/** The icons a row carries beside the connection. */
export type VoiceFlags = Pick<VoiceState, 'micOn' | 'cameraOn' | 'screenSharing' | 'modMuted'>

/**
 * What a change writes to a person's row, decided on the row read under
 * their lock:
 * - `put`: this connection is the one they are in, every icon off until its
 *   tab reports them (D-206);
 * - `remove`: they are in no room;
 * - `flags`: the same connection, these icons changed.
 */
export type VoiceWrite =
    | { kind: 'put'; connection: VoiceConnection }
    | { kind: 'remove' }
    | { kind: 'flags'; flags: Partial<VoiceFlags> }

/** A connection that joined (participant_joined, or the reconciliation): see joinOutcome. */
export const joinWrite = (current: VoiceState | null, joined: VoiceConnection): VoiceWrite | null =>
    joinOutcome(current, joined) === 'ignore' ? null : { kind: 'put', connection: joined }

/** A connection that left, or the person put out: see leaveApplies. */
export const leaveWrite = (current: VoiceState | null, participantSid: string): VoiceWrite | null =>
    leaveApplies(current, participantSid) ? { kind: 'remove' } : null

/**
 * What the person's browser says of its microphone and camera (D-206):
 * nothing to write when they are in no room, or nothing changed.
 */
export function selfStateWrite(current: VoiceState | null, micOn: boolean, cameraOn: boolean): VoiceWrite | null {
    if (!current || (current.micOn === micOn && current.cameraOn === cameraOn)) return null
    return { kind: 'flags', flags: { micOn, cameraOn } }
}

/**
 * How long a webhook's id is remembered, so the same event sent again is
 * taken once (D-210). LiveKit sends one again within minutes; a day is far
 * past that.
 */
export const MEDIA_EVENT_MEMORY_SECONDS = 24 * 60 * 60
