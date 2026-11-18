import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AccessToken, RoomServiceClient, ServerError, TrackSource } from 'livekit-server-sdk'
import { JoinGrant, MediaRoomsPort, MediaSource, RoomParticipant } from '@/modules/voice/application'
import { JOIN_TOKEN_TTL_SECONDS, MediaRoomsUnavailableError } from '@/modules/voice/domain'

/**
 * How long one call to LiveKit may take. A request that waits on it (joining,
 * a moderator putting someone out) answers 503 rather than hang until the
 * request timeout. Against LiveKit Cloud the SDK may try up to two more
 * regions after a timeout, each with this limit (M7).
 */
const REQUEST_TIMEOUT_SECONDS = 5

const SOURCES: Record<MediaSource, TrackSource> = {
    microphone: TrackSource.MICROPHONE,
    camera: TrackSource.CAMERA,
    screen_share: TrackSource.SCREEN_SHARE,
    screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO
}

/** LiveKit's answer when the room does not exist, or the person is not in it. */
const isNotFound = (error: unknown) =>
    error instanceof ServerError && (error.status === 404 || error.code === 'not_found')

/** LiveKit refused the key or secret: a setting to fix, not a moment to wait out. */
const isRefusedKey = (error: unknown) => error instanceof ServerError && (error.status === 401 || error.status === 403)

/**
 * LiveKit Media Rooms Adapter — Outbound Adapter
 *
 * LiveKit's server SDK behind MediaRoomsPort: tokens signed with the API key
 * and secret, and its RoomService for who is in a room. The same address
 * serves browsers (ws/wss) and the RoomService, which the SDK reaches over
 * http/https.
 */
@Injectable()
export class LiveKitMediaRooms implements MediaRoomsPort {
    private readonly logger = new Logger(LiveKitMediaRooms.name)
    private readonly url: string
    private readonly apiKey: string
    private readonly apiSecret: string
    private readonly rooms: RoomServiceClient

    constructor(config: ConfigService) {
        this.url = config.getOrThrow<string>('livekit.url')
        this.apiKey = config.getOrThrow<string>('livekit.apiKey')
        this.apiSecret = config.getOrThrow<string>('livekit.apiSecret')
        this.rooms = new RoomServiceClient(this.url, this.apiKey, this.apiSecret, {
            requestTimeout: REQUEST_TIMEOUT_SECONDS
        })
    }

    async issueJoinToken(grant: JoinGrant): Promise<{ token: string; url: string }> {
        const token = new AccessToken(this.apiKey, this.apiSecret, {
            identity: grant.identity,
            name: grant.name,
            ttl: JOIN_TOKEN_TTL_SECONDS
        })
        token.addGrant({
            roomJoin: true,
            room: grant.room,
            canSubscribe: true,
            canPublish: grant.sources.length > 0,
            canPublishSources: grant.sources.map((source) => SOURCES[source]),
            // Room chat is the channel's messages (D-210), not LiveKit's data channel.
            canPublishData: false
        })
        return { token: await token.toJwt(), url: this.url }
    }

    async listParticipants(room: string): Promise<RoomParticipant[]> {
        try {
            const participants = await this.rooms.listParticipants(room)
            return participants.map((participant) => ({
                identity: participant.identity,
                sid: participant.sid,
                joinedAt: new Date(Number(participant.joinedAtMs))
            }))
        } catch (error) {
            // The local server lists nobody for a room it never heard of; a
            // "not found" means the same.
            if (isNotFound(error)) return []
            throw this.unavailable('list the people of', room, error)
        }
    }

    async removeParticipant(room: string, identity: string): Promise<void> {
        try {
            await this.rooms.removeParticipant(room, identity)
        } catch (error) {
            if (isNotFound(error)) return
            throw this.unavailable('put a person out of', room, error)
        }
    }

    /**
     * The 503 the person sees, with the cause in the log: the answer itself
     * only says to try again, and a refused key would never pass by waiting.
     */
    private unavailable(action: string, room: string, error: unknown): MediaRoomsUnavailableError {
        const cause =
            error instanceof ServerError
                ? `${error.status} ${error.code ?? ''} ${error.message}`.replace(/\s+/g, ' ')
                : (error as Error).message
        const message = `Could not ${action} ${room}: ${cause}`
        if (isRefusedKey(error)) {
            this.logger.error(`${message}. Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET`)
        } else {
            this.logger.warn(message)
        }
        return new MediaRoomsUnavailableError()
    }
}
