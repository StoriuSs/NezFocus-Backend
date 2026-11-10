import { IsUUID } from 'class-validator'
import { ServerIdParamsDto } from './server-id.params.dto'

export class ServerChannelParamsDto extends ServerIdParamsDto {
    @IsUUID()
    channelId: string
}
