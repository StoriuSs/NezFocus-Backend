import { IsUUID } from 'class-validator'

export class ChannelIdParamsDto {
    @IsUUID()
    channelId: string
}
