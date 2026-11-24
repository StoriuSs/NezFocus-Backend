import { Expose } from 'class-transformer'
import { IsString } from 'class-validator'

/** A server we share (D-109); its picture is in my own list of servers. */
export class MutualServerResponseDto {
    @Expose()
    @IsString()
    id: string

    @Expose()
    @IsString()
    name: string
}
