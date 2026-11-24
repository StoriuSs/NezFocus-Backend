import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

/** What the browser connects to the call's room with (D-239): as a voice room's token (D-210). */
export class CallMediaResponseDto {
    /** Good for the first connection within 10 minutes; LiveKit renews it itself once in. */
    @Expose()
    @IsString()
    token: string

    /** LiveKit's address: ws://localhost:7880 in development, wss:// in production. */
    @Expose()
    @IsString()
    url: string
}
