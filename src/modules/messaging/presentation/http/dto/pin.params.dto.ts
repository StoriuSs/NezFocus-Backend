import { IsUUID } from 'class-validator'
import { ChannelIdParamsDto } from './channel-id.params.dto'

/** `/channels/{channel_id}/pins/{message_id}`. */
export class PinParamsDto extends ChannelIdParamsDto {
    @IsUUID()
    messageId: string
}
