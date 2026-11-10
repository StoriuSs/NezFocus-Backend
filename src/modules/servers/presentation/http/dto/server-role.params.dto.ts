import { IsUUID } from 'class-validator'
import { ServerIdParamsDto } from './server-id.params.dto'

export class ServerRoleParamsDto extends ServerIdParamsDto {
    @IsUUID()
    roleId: string
}
