import { UserDirectoryPort } from '@/modules/users'
import { CallEndReason, CallRecord, CallStatus, isOpenCall } from '../../domain'
import { PersonView, personViews } from './relationship-views'

/** A call as one of its two sees it (SRS 5.1, D-245): the other one with it, for a card shown on any page. */
export interface CallView {
    id: string
    /** The DM it belongs to (its channel id). */
    dmId: string
    callerId: string
    calleeId: string
    /** Started as a video call; either camera turns on or off at any time. */
    video: boolean
    status: CallStatus
    /** Only on `missed`. */
    endReason: CallEndReason | null
    /** The other one of the two, as I see them (D-182). */
    user: PersonView
    createdAt: Date
    acceptedAt: Date | null
    endedAt: Date | null
}

/** The calls as `viewerId`, one of the two of each, sees them, in the order given; pictures signed once. */
export async function callViews(users: UserDirectoryPort, viewerId: string, calls: CallRecord[]): Promise<CallView[]> {
    const others = calls.map((call) => (call.callerId === viewerId ? call.callee : call.caller))
    const people = await personViews(users, others)
    return calls.map((call, index) => ({
        id: call.id,
        dmId: call.dmChannelId,
        callerId: call.callerId,
        calleeId: call.calleeId,
        video: call.video,
        status: call.status,
        endReason: call.endReason,
        user: people[index]!,
        createdAt: call.createdAt,
        acceptedAt: call.acceptedAt,
        endedAt: call.endedAt
    }))
}

/** My open calls (`GET /me/call`, D-245): the one I make or am in, and those ringing to me. */
export interface MyCallsView {
    current: CallView | null
    incoming: CallView[]
}

/** My open calls split as `GET /me/call` gives them; `open` read oldest first. */
export async function myCallsView(users: UserDirectoryPort, userId: string, open: CallRecord[]): Promise<MyCallsView> {
    const views = await callViews(users, userId, open.filter(isOpenCall))
    const incoming = views.filter((call) => call.status === 'ringing' && call.calleeId === userId)
    return { current: views.find((call) => !incoming.includes(call)) ?? null, incoming }
}
