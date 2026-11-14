import { IsOptional, IsUUID } from 'class-validator'

/** POST /channels/{id}/ack (REQ-MSG-09). */
export class AckChannelRequestDto {
    /**
     * The newest message of the channel the reader has seen (D-46), deleted
     * or not. Left out: the channel's newest message ("Mark as read"). The
     * mark only moves forward (D-173).
     */
    @IsOptional()
    @IsUUID()
    messageId?: string
}
