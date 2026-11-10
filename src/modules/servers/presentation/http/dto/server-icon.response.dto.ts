import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

export class ServerIconResponseDto {
    @Expose()
    @IsString()
    iconUrl: string
}
