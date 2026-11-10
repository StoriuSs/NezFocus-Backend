import { Expose } from 'class-transformer'
import { IsInt, IsString } from 'class-validator'

export class ServerCategoryResponseDto {
    @Expose()
    @IsString()
    id: string

    /** As typed; the channel list shows it in capitals. */
    @Expose()
    @IsString()
    name: string

    /** Order among the categories, 0 first. */
    @Expose()
    @IsInt()
    position: number
}
