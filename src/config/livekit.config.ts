import { registerAs } from '@nestjs/config'

/**
 * LiveKit, the media server of voice and video rooms (D-204). The defaults
 * are the local development server of docker-compose.dev.yaml; production
 * requires all three (validation.ts).
 */
export default registerAs('livekit', () => ({
    /** Where browsers and the API both reach LiveKit. */
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET || 'secret'
}))
