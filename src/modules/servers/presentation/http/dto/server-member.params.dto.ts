import { IsUUID } from 'class-validator'
import { ServerIdParamsDto } from './server-id.params.dto'

export class ServerMemberParamsDto extends ServerIdParamsDto {
    @IsUUID()
    userId: string
}
