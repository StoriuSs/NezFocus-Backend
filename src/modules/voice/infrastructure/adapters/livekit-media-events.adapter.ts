import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WebhookEvent, WebhookReceiver } from 'livekit-server-sdk'
import { MediaEvent, MediaEventsPort } from '@/modules/voice/application'
import { MediaEventRejectedError } from '@/modules/voice/domain'

/** LiveKit's events voice acts on, by kind; any other is `other`. */
const KINDS: Partial<Record<WebhookEvent['event'], 'joined' | 'left'>> = {
    participant_joined: 'joined',
    participant_left: 'left',
    // Never got through: as good as gone.
    participant_connection_aborted: 'left'
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
        const kind = KINDS[event.event]
        const { participant, room } = event
        if (!kind || !participant || !room) return { id: event.id, kind: 'other' }
        return {
            id: event.id,
            kind,
            room: room.name,
            identity: participant.identity,
            participantSid: participant.sid,
            joinedAt: new Date(Number(participant.joinedAtMs || participant.joinedAt * 1000n))
        }
    }
}
