import { Module } from '@nestjs/common'
import { MEDIA_ROOMS } from './application'
import { LiveKitMediaRooms } from './infrastructure'

/**
 * Voice rooms (SRS 4.5, ARCHITECTURE 4): LiveKit carries the media; this
 * module gives the tokens to join, keeps who is in which room (VoiceState)
 * and puts people out. So far only the media server behind MEDIA_ROOMS
 * (M4 L1); the routes, webhooks and events come with M4 L2.
 *
 * ConfigService comes from the global ConfigModule (livekit.config.ts).
 */
@Module({
    providers: [{ provide: MEDIA_ROOMS, useClass: LiveKitMediaRooms }]
})
export class VoiceModule {}
