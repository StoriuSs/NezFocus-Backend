import { Expose, Type } from 'class-transformer'
import { IsArray, ValidateNested } from 'class-validator'
import { DmResponseDto } from './dm.response.dto'

/** My DMs shown in my list (D-244: never closed, or a message after I closed it), the latest active first. */
export class DmListResponseDto {
    @Expose()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DmResponseDto)
    dms: DmResponseDto[]
}
