import { Expose, Type } from 'class-transformer'
import { ValidateNested } from 'class-validator'
import { ServerResponseDto } from './server.response.dto'

/** GET /servers: in the order they joined (C-05). */
export class ServerListResponseDto {
    @Expose()
    @ValidateNested({ each: true })
    @Type(() => ServerResponseDto)
    servers: ServerResponseDto[]
}
