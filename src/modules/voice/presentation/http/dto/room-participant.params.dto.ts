import { IsUUID } from 'class-validator'

/** /voice/rooms/{channel_id}/participants/{user_id}: someone in a voice room a moderator acts on (REQ-VC-04). */
export class RoomParticipantParamsDto {
    @IsUUID()
    channelId: string

    @IsUUID()
    userId: string
}
