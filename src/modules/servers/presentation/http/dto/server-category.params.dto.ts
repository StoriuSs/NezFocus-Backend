import { IsUUID } from 'class-validator'
import { ServerIdParamsDto } from './server-id.params.dto'

export class ServerCategoryParamsDto extends ServerIdParamsDto {
    @IsUUID()
    categoryId: string
}
