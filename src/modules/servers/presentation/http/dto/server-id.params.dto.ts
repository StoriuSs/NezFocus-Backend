import { IsUUID } from 'class-validator'

export class ServerIdParamsDto {
    @IsUUID()
    serverId: string
}

export class ServerCategoryParamsDto extends ServerIdParamsDto {
    @IsUUID()
    categoryId: string
}

export class ServerChannelParamsDto extends ServerIdParamsDto {
    @IsUUID()
    channelId: string
}
