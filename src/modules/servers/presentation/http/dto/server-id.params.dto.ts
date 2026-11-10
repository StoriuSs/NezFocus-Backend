import { IsUUID } from 'class-validator'

export class ServerIdParamsDto {
    @IsUUID()
    serverId: string
}
