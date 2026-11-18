import { IsUUID } from 'class-validator'

/** POST /voice/token: the voice room to join ("Vào phòng", REQ-VC-01). */
export class JoinVoiceRequestDto {
    @IsUUID()
    channelId: string
}
