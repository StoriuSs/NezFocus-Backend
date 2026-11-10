import { IsUUID } from 'class-validator'
import { ServerRoleParamsDto } from './server-role.params.dto'

export class ServerRoleMemberParamsDto extends ServerRoleParamsDto {
    @IsUUID()
    userId: string
}
