import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ParticipantInfo, TrackSource, WebhookEvent, WebhookReceiver } from 'livekit-server-sdk'
import { MediaEvent, MediaEventsPort } from '@/modules/voice/application'
import { MediaEventRejectedError } from '@/modules/voice/domain'
import { sessionOf } from './session-attribute'

/** LiveKit's events voice acts on, by kind; any other is `other`. */
const KINDS: Partial<Record<WebhookEvent['event'], 'joined' | 'left'>> = {
    participant_joined: 'joined',
    participant_left: 'left',
    // Never got through: as good as gone.
    participant_connection_aborted: 'left'
}

/**
 * Why LiveKit ended a connection, when it was the server's doing: the API
 * removed it (PARTICIPANT_REMOVED = 4) or the room was deleted (ROOM_DELETED
 * = 5), values of @livekit/protocol's DisconnectReason, which the SDK does
 * not export by name. Any other (the client left, which a closed or reloaded
 * page does too; a newer connection of the account; the link lost) is a
 * lost connection (D-215, D-228).
 */
const REMOVED = new Set<ParticipantInfo['disconnectReason']>([4, 5])

/** A screen's track published or unpublished (D-101); any other track is `other`. */
const SHARES: Partial<Record<WebhookEvent['event'], 'share_started' | 'share_stopped'>> = {
    track_published: 'share_started',
    track_unpublished: 'share_stopped'
}

/**
 * LiveKit Media Events Adapter — Inbound Adapter
 *
 * LiveKit's webhooks (D-210), checked with its SDK's WebhookReceiver: the
 * Authorization header is a JWT signed with the API secret, holding the
 * sha256 of the body as it was sent. So the body must reach here exactly as
 * it came (configure-app.ts reads `application/webhook+json` as text).
 */
@Injectable()
export class LiveKitMediaEvents implements MediaEventsPort {
    private readonly receiver: WebhookReceiver

    constructor(config: ConfigService) {
        this.receiver = new WebhookReceiver(
            config.getOrThrow<string>('livekit.apiKey'),
            config.getOrThrow<string>('livekit.apiSecret')
        )
    }

    async read(body: string, authorization: string | undefined): Promise<MediaEvent> {
        let event: WebhookEvent
        try {
            event = await this.receiver.receive(body, authorization)
        } catch (error) {
            throw new MediaEventRejectedError((error as Error).message)
        }
        const { participant, room, track } = event
        if (!participant || !room) return { id: event.id, kind: 'other' }
        const share = SHARES[event.event]
        if (share) {
            if (track?.source !== TrackSource.SCREEN_SHARE) return { id: event.id, kind: 'other' }
            return {
                id: event.id,
                kind: share,
                room: room.name,
                identity: participant.identity,
                participantSid: participant.sid,
                trackSid: track.sid
            }
        }
        const kind = KINDS[event.event]
        if (!kind) return { id: event.id, kind: 'other' }
        return {
            id: event.id,
            kind,
            room: room.name,
            identity: participant.identity,
            participantSid: participant.sid,
            joinedAt: new Date(Number(participant.joinedAtMs || participant.joinedAt * 1000n)),
            sessionId: sessionOf(participant),
            ...(kind === 'left' && REMOVED.has(participant.disconnectReason) && { removed: true as const })
        }
    }
}
